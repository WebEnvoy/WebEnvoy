import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createFixtureLauncher, HarborRuntime, type LocalProviderLauncher, type LocalProviderLaunchInput } from "./index.js";
import type { IdentityEnvironmentMutationPersistenceState } from "./identity-environment-mutation-types.js";
import { waitForXiaohongshuSiteResourceReadiness } from "./local-provider-launcher.js";
import { trustLocalProviderReadProbe, trustLocalProviderSiteResourceProbe, type ReadOperationProbe, type SiteResourceProbe } from "./read-operation-probe-trust.js";
import { opaqueRef } from "./refs.js";
import { startHarborRuntimeServer as startUnconfiguredHarborRuntimeServer } from "./server.js";

const testProfileRoot = mkdtempSync(join(tmpdir(), "harbor-server-profiles-"));
const identityAliases = new Map<string, string>();
const identityEnvironmentOwners = new Map<string, HarborRuntime>();
process.env.HARBOR_PROFILE_STORAGE_ROOT = testProfileRoot;
after(() => rmSync(testProfileRoot, { recursive: true, force: true }));

async function startHarborRuntimeServer(options: Parameters<typeof startUnconfiguredHarborRuntimeServer>[0] = {}) {
  const running = await startUnconfiguredHarborRuntimeServer({
    ...options,
    manual_authentication_supervisor_token: options.manual_authentication_supervisor_token ?? supervisorToken()
  });
  if (options.runtime) identityEnvironmentOwners.set(running.url, options.runtime);
  return {
    ...running,
    close: async () => {
      identityEnvironmentOwners.delete(running.url);
      await running.close();
    }
  };
}

test("serves readiness and provider facts as JSON", async () => {
  const runtime = new HarborRuntime(createFixtureLauncher("ready"));
  const running = await startHarborRuntimeServer({ port: 0, runtime });
  try {
    for (const path of ["/health", "/ready", "/readiness", "/runtime/health"]) {
      const readiness = await getJson(`${running.url}${path}`);
      assert.equal(readiness.status, "ready");
      assert.equal(readiness.safety_boundary.raw_credentials, "not_exposed");
    }

    const providers = await getJson(`${running.url}/runtime/browser-providers`);
    assert.equal(providers.schema_version, "harbor-browser-provider-status/v0");
    assert.equal(providers.providers.length, 2);

    const alias = await getJson(`${running.url}/runtime/browser-provider-status`);
    assert.deepEqual(alias, providers);
  } finally {
    await running.close();
  }
});

test("serves canonical owner runtime facts separately from legacy business adapters", async () => {
  const runtime = new HarborRuntime(createFixtureLauncher("ready"));
  const running = await startHarborRuntimeServer({ port: 0, runtime });
  try {
    const session = await runtime.createSession({
      url: "https://example.test/runtime-facts",
      control_owner: "core_task",
      holder_ref: "owner-facts",
      identity_environment_ref: "identity-env_runtime-facts",
      execution_identity_ref: "execution-identity_runtime-facts"
    });
    const ownerFacts = await getJson(`${running.url}/runtime/sessions/${session.runtime_session_ref}/runtime-facts`);
    assert.equal(ownerFacts.schema_version, "harbor-core-runtime-facts/v0");
    assert.equal(ownerFacts.identity_environment_ref, session.identity_environment_ref);
    assert.equal(ownerFacts.execution_identity_ref, session.execution_identity_ref);
    assert.equal(ownerFacts.fact_refs.session, session.runtime_session_ref);
    assert.equal(ownerFacts.fact_refs.viewer, session.viewer_ref);
    const ownerJson = JSON.stringify(ownerFacts).toLowerCase();
    for (const forbidden of ["public_summary", "normalized", "lode_pin", "xiaohongshu", "boss", "cookie", "token", "raw_dom", "raw_har"]) {
      assert.equal(ownerJson.includes(forbidden), false, `canonical owner facts leaked ${forbidden}`);
    }

    const missingResponse = await fetch(`${running.url}/runtime/sessions/session_missing/runtime-facts`);
    assert.equal(missingResponse.status, 404);
    const missing = await missingResponse.json() as Record<string, unknown>;
    assert.equal(missing.status, "unavailable");
    assert.equal(missing.failure_class, "session_missing");
  } finally {
    await running.close();
  }
});

test("redacts provider error details from canonical runtime facts", async () => {
  const leakedMessage = "Authorization: Bearer secret-token /private/path/profile";
  const runtime = new HarborRuntime(async (input) => ({
    status: "ready",
    execution_surface: "fixture",
    cdp_ref: opaqueRef("cdp"),
    viewer_entry: {
      availability: "unsupported",
      access_mode: "none",
      transport: "not_applicable",
      input_capabilities: [],
      unavailable_reason: "unsupported"
    },
    page: {
      current_url: input.url,
      title: null,
      status: "unavailable",
      error: { code: "cdp_unavailable", message: leakedMessage, retryable: true },
      facts: []
    },
    facts: [],
    openUrl: async (url) => ({
      current_url: url,
      title: null,
      status: "unavailable",
      error: { code: "cdp_unavailable", message: leakedMessage, retryable: true },
      facts: []
    }),
    captureScreenshot: async () => ({ code: "cdp_unavailable", message: leakedMessage, retryable: true }),
    close: async () => {}
  }));
  const session = await runtime.createSession({ url: "https://example.test/runtime-error" });
  const direct = runtime.getCoreRuntimeFacts(session.runtime_session_ref);
  assert.equal("status" in direct, false);
  if ("status" in direct) throw new Error("core facts should be readable");
  assert.deepEqual(direct.current_error, {
    code: "cdp_unavailable",
    message: "Runtime Session is unavailable.",
    retryable: true
  });
  assert.equal(JSON.stringify(direct).includes(leakedMessage), false);

  const running = await startHarborRuntimeServer({ port: 0, runtime });
  try {
    const response = await fetch(`${running.url}/runtime/sessions/${session.runtime_session_ref}/runtime-facts`);
    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, any>;
    assert.deepEqual(body.current_error, direct.current_error);
    assert.equal(JSON.stringify(body).includes(leakedMessage), false);
    assert.equal(JSON.stringify(body).includes("/private/path"), false);
  } finally {
    await running.close();
  }
});

test("serves identity, session, and evidence endpoint plumbing", async () => {
  const runtime = new HarborRuntime(createFixtureLauncher("ready"));
  const running = await startHarborRuntimeServer({ port: 0, runtime });
  try {
    const emptyList = await getJson(`${running.url}/runtime/identity-environments`);
    assert.deepEqual(emptyList.identity_environments, []);

    const created = await postIdentityEnvironment(`${running.url}/runtime/identity-environments`, {
      identity_environment_ref: "identity-env_server-test",
      execution_identity_ref: "execution-identity_server-test",
      profile_ref: "profile_server-test",
      profile_storage_ref: "profile-storage_server-test",
      site: {
        site_id: "xiaohongshu",
        origin: "https://www.xiaohongshu.com",
        display_name: "小红书",
        account_ref: "account_server-test"
      },
      login_state: "manual_auth_required",
      storage_state: "present",
      language: "zh-CN",
      timezone: "Asia/Shanghai"
    });
    assert.match(created.identity_environment_ref, /^identity-env_[a-f0-9]{24}$/);
    assert.equal(created.public_boundary.raw_material, "not_exposed");
    assert.equal(created.record.refs.profile_storage_ref.startsWith("profile_storage_ref_"), true);

    const identityReadback = await getJson(`${running.url}/runtime/identity-environments/identity-env_server-test`);
    assert.equal(identityReadback.identity_environment_ref, created.identity_environment_ref);
    assert.equal(identityReadback.environment_summary.language, "zh-CN");
    assert.equal(JSON.stringify(identityReadback).includes("profile-storage_server-test"), false);

    const updatedIdentity = await patchJson(`${running.url}/runtime/identity-environments/identity-env_server-test`, {
      language: "en-US"
    });
    assert.equal(updatedIdentity.record.environment_summary.language, "en-US");
    runtime.updateLocalIdentityEnvironment(resolvedIdentityRef("identity-env_server-test"), { login_state: "logged_in", storage_state: "present" });

    const session = await postJson(`${running.url}/runtime/identity-environment-sessions`, {
      identity_environment_ref: "identity-env_server-test",
      url: "https://example.test/runtime-api",
      control_owner: "agent",
      holder_ref: "server-test"
    });
    assert.equal(session.lifecycle_state, "active");

    const readback = await getJson(`${running.url}/runtime/sessions/${session.runtime_session_ref}`);
    assert.equal(readback.runtime_session_ref, session.runtime_session_ref);

    const snapshot = await postJson(`${running.url}/runtime/sessions/${session.runtime_session_ref}/snapshot`, {});
    assert.equal(snapshot.status, "captured");
    assert.equal(snapshot.evidence_refs.length > 0, true);

    const siteFacts = await getJson(`${running.url}/runtime/sessions/${session.runtime_session_ref}/site-resource-facts?site_id=xiaohongshu&task_kind=search_notes`);
    assert.equal(siteFacts.schema_version, "harbor-site-resource-facts/v0");
    assert.equal(siteFacts.runtime_session_ref, session.runtime_session_ref);
    assert.equal(siteFacts.site_id, "xiaohongshu");
    assert.equal(siteFacts.task_kind, "search_notes");
    assert.equal(siteFacts.resource_facts.some((fact: any) => fact.key === "runtime.execution_surface.available"), true);
    assert.equal(siteFacts.resource_facts.some((fact: any) => fact.key === "identity.user_logged_in.confirmed"), true);
    assert.equal(siteFacts.resource_facts.find((fact: any) => fact.key === "identity.user_logged_in.confirmed")?.state, "available");
    assert.equal(siteFacts.resource_facts.find((fact: any) => fact.key === "page.vue_app.ready")?.state, "available");
    assert.equal(siteFacts.resource_facts.find((fact: any) => fact.key === "page.pinia_store.ready")?.state, "available");
    assert.equal(siteFacts.evidence_refs.length > 0, true);
    assert.equal(siteFacts.public_boundary.raw_dom, "not_exposed");

    const siteEvidence = await getJson(`${running.url}/runtime/evidence/${siteFacts.evidence_refs[0]}`);
    assert.equal(siteEvidence.evidence_ref, siteFacts.evidence_refs[0]);
    assert.equal(siteEvidence.artifact?.raw_bytes ?? "not_exposed", "not_exposed");

    const writePrecheck = await postJson(`${running.url}/runtime/sessions/${session.runtime_session_ref}/write-precheck-facts`, {
      site_id: "xiaohongshu",
      title: "Spoofed title",
      url: "https://attacker.example/write-precheck",
      summary: "Spoofed summary",
      locator_hint: "body[data-spoofed=true]",
      target_label: "Publish note precheck",
      fields: [
        { label: "Title", input_kind: "text", required: true, sensitivity: "public", value_state: "present" },
        { label: "Body", input_kind: "textarea", required: true, sensitivity: "public", value_state: "present" }
      ]
    });
    assert.equal(writePrecheck.schema_version, "harbor-write-precheck-facts/v0");
    assert.equal(writePrecheck.submitted, false);
    assert.equal(writePrecheck.pre_write_guard.no_submit_guard, "active");
    assert.equal(writePrecheck.writable_target.provenance.source, "provided_context");
    assert.notEqual(writePrecheck.writable_target.locator_hint, "body[data-spoofed=true]");
    assert.equal(writePrecheck.privacy_boundary.raw_values, "not_exposed");
    const writeEvidence = await getJson(`${running.url}/runtime/evidence/${writePrecheck.writable_target.evidence_refs[0]}`);
    assert.equal(writeEvidence.provenance.source_locator.includes(session.runtime_session_ref), true);
    assert.equal(JSON.stringify(writeEvidence).includes("attacker.example"), false);

    const evidence = await getJson(`${running.url}/runtime/evidence/${snapshot.evidence_refs[0]}`);
    assert.equal(evidence.evidence_ref, snapshot.evidence_refs[0]);
    assert.equal(JSON.stringify(evidence).includes("cookie"), false);

    const stopped = await postJson(`${running.url}/runtime/sessions/${session.runtime_session_ref}/stop`, { control_owner: "agent" });
    assert.equal(stopped.lifecycle_state, "closed");

    const closedReadback = await getJson(`${running.url}/runtime/sessions/${session.runtime_session_ref}`);
    assert.equal(closedReadback.lifecycle_state, "closed");

    const aliasReadback = await getJson(`${running.url}/runtime/identity-environment-sessions/${session.runtime_session_ref}`);
    assert.equal(aliasReadback.runtime_session_ref, session.runtime_session_ref);

    const deletedIdentity = await deleteJson(`${running.url}/runtime/identity-environments/identity-env_server-test`);
    assert.equal(deletedIdentity.identity_environment_ref, created.identity_environment_ref);

    const missingIdentity = await fetch(`${running.url}/runtime/identity-environments/identity-env_server-test`);
    assert.equal(missingIdentity.status, 404);
    assert.equal((await missingIdentity.json()).failure_class, "identity_environment_missing");

    const nestedIdentityPath = await fetch(`${running.url}/runtime/identity-environments/identity-env_server-test/extra`);
    assert.equal(nestedIdentityPath.status, 404);
  } finally {
    await running.close();
  }
});

test("rejects Harbor-owned identity state on the legacy create endpoint", async () => {
  const runtime = new HarborRuntime(createFixtureLauncher("ready"));
  const running = await startHarborRuntimeServer({ port: 0, runtime });
  try {
    const response = await fetch(`${running.url}/runtime/identity-environments`, {
      method: "POST",
      body: JSON.stringify({
        login_state: "logged_in",
        login_state_reason: "caller_claim",
        storage_state: "present",
        manual_authentication_state: "completed"
      }),
      headers: {
        "content-type": "application/json",
        "idempotency-key": opaqueRef("request"),
        ...manualAuthHeaders()
      }
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "bad_request",
      message: "Invalid identity environment create/import request."
    });
    assert.deepEqual(runtime.listLocalIdentityEnvironments(), []);
  } finally {
    await running.close();
  }
});

test("serves a trusted refs-only BOSS SPA fact while deferring exact WAPI evidence", async () => {
  const siteProbe = trustLocalProviderSiteResourceProbe(async () => ({
    status: "available",
    observed_at: "2026-07-12T00:00:00.000Z",
    evidence_ref: "validation_boss-spa-test",
    verified_fact_keys: ["page.boss_spa.ready"]
  }));
  const readProbe = trustLocalProviderReadProbe(async (probe) => completedBossReadProbe(probe));
  const runtime = new HarborRuntime(createBossReadLauncher(readProbe, siteProbe));
  const running = await startHarborRuntimeServer({ port: 0, runtime });
  try {
    const session = await runtime.createSession({
      url: "https://www.zhipin.com/web/geek/job",
      control_owner: "agent",
      holder_ref: "boss-site-resource-test"
    });
    const facts = await getJson(`${running.url}/runtime/sessions/${session.runtime_session_ref}/site-resource-facts?site_id=boss&task_kind=job_search`);
    const spa = facts.resource_facts.find((fact: { key: string }) => fact.key === "page.boss_spa.ready");
    const wapi = facts.resource_facts.find((fact: { key: string }) => fact.key === "network.wapi_zpgeek.available");
    assert.deepEqual({ state: spa.state, source: spa.source, evidence_ref: spa.evidence_ref }, {
      state: "available",
      source: "validation_evidence",
      evidence_ref: "validation_boss-spa-test"
    });
    assert.equal(wapi.state, "unknown");
    assert.match(wapi.message, /deferred to the allowlisted read-operation probe/);
    const publicJson = JSON.stringify(facts).toLowerCase();
    for (const forbidden of ["<html", "response_body", "cookie_value", "access_token", "profile_path", "websocketdebuggerurl"]) {
      assert.equal(publicJson.includes(forbidden), false);
    }
    assert.equal(facts.public_boundary.raw_dom, "not_exposed");
    assert.equal(facts.public_boundary.raw_network_bodies, "not_exposed");
  } finally {
    await running.close();
  }
});

test("serves trusted XHS Vue and Pinia readiness for a non-fixture detail session", async () => {
  let probeCalls = 0;
  let observations = 0;
  const siteProbe = trustLocalProviderSiteResourceProbe(async () => {
    probeCalls += 1;
    return waitForXiaohongshuSiteResourceReadiness(async () => {
      observations += 1;
      return {
        origin: "https://www.xiaohongshu.com",
        ready: true,
        login_like: false,
        challenge_like: false,
        vue_ready: observations > 1,
        pinia_ready: observations > 1
      };
    }, new AbortController().signal, 0);
  });
  const readProbe = trustLocalProviderReadProbe(async (probe) => completedBossReadProbe(probe));
  const runtime = new HarborRuntime(createBossReadLauncher(readProbe, siteProbe));
  const running = await startHarborRuntimeServer({ port: 0, runtime });
  try {
    const session = await runtime.createSession({
      url: "https://www.xiaohongshu.com/explore/0123456789abcdef01234567",
      control_owner: "agent",
      holder_ref: "xhs-site-resource-test"
    });
    const facts = await getJson(`${running.url}/runtime/sessions/${session.runtime_session_ref}/site-resource-facts?site_id=xiaohongshu&task_kind=read_note_detail`);
    const vue = facts.resource_facts.find((fact: { key: string }) => fact.key === "page.vue_app.ready");
    const pinia = facts.resource_facts.find((fact: { key: string }) => fact.key === "page.pinia_store.ready");
    assert.equal(probeCalls, 1);
    assert.equal(observations, 2);
    assert.deepEqual({ state: vue.state, source: vue.source }, {
      state: "available",
      source: "validation_evidence"
    });
    assert.deepEqual({ state: pinia.state, source: pinia.source }, {
      state: "available",
      source: "validation_evidence"
    });
    assert.equal(typeof vue.evidence_ref, "string");
    assert.equal(vue.evidence_ref, pinia.evidence_ref);
    const publicJson = JSON.stringify(facts).toLowerCase();
    for (const forbidden of ["<html", "response_body", "cookie_value", "access_token", "profile_path", "websocketdebuggerurl"]) {
      assert.equal(publicJson.includes(forbidden), false);
    }
    assert.equal(facts.public_boundary.raw_dom, "not_exposed");
    assert.equal(facts.public_boundary.raw_network_bodies, "not_exposed");
  } finally {
    await running.close();
  }
});

test("does not promote unverified XHS readiness facts", async () => {
  const siteProbe = trustLocalProviderSiteResourceProbe(async () => ({
    status: "unavailable",
    failure_class: "page_not_ready",
    message: "The Xiaohongshu Pinia store is not ready.",
    verified_fact_keys: ["page.vue_app.ready"],
    evidence_ref: "validation_xhs-partial-readiness-test"
  }));
  const readProbe = trustLocalProviderReadProbe(async (probe) => completedBossReadProbe(probe));
  const runtime = new HarborRuntime(createBossReadLauncher(readProbe, siteProbe));
  const running = await startHarborRuntimeServer({ port: 0, runtime });
  try {
    const session = await runtime.createSession({ url: "https://www.xiaohongshu.com/explore" });
    const facts = await getJson(`${running.url}/runtime/sessions/${session.runtime_session_ref}/site-resource-facts?site_id=xiaohongshu&task_kind=read_note_detail`);
    const vue = facts.resource_facts.find((fact: { key: string }) => fact.key === "page.vue_app.ready");
    const pinia = facts.resource_facts.find((fact: { key: string }) => fact.key === "page.pinia_store.ready");
    assert.deepEqual({ state: vue.state, source: vue.source, evidence_ref: vue.evidence_ref }, {
      state: "available",
      source: "validation_evidence",
      evidence_ref: "validation_xhs-partial-readiness-test"
    });
    assert.equal(pinia.state, "unavailable");
    assert.equal(pinia.severity, "blocking");
  } finally {
    await running.close();
  }
});

test("maps trusted XHS login and challenge probes to blocking admission facts", async () => {
  for (const probeResult of [
    { status: "blocked" as const, failure_class: "not_logged_in" as const, message: "manual login required", verified_fact_keys: [] },
    { status: "blocked" as const, failure_class: "safety_challenge" as const, message: "challenge present", verified_fact_keys: [] }
  ]) {
    const siteProbe = trustLocalProviderSiteResourceProbe(async () => probeResult);
    const readProbe = trustLocalProviderReadProbe(async (probe) => completedBossReadProbe(probe));
    const runtime = new HarborRuntime(createBossReadLauncher(readProbe, siteProbe));
    const running = await startHarborRuntimeServer({ port: 0, runtime });
    try {
      const session = await runtime.createSession({ url: "https://www.xiaohongshu.com/explore" });
      const facts = await getJson(`${running.url}/runtime/sessions/${session.runtime_session_ref}/site-resource-facts?site_id=xiaohongshu&task_kind=read_note_detail`);
      const key = probeResult.failure_class === "not_logged_in" ? "identity.user_logged_in.confirmed" : "safety.challenge.absent";
      const fact = facts.resource_facts.find((candidate: { key: string }) => candidate.key === key);
      assert.equal(fact.state, "blocked");
      assert.equal(fact.severity, "blocking");
      assert.equal(fact.message, probeResult.message);
      const readinessFacts = facts.resource_facts.filter((candidate: { key: string }) =>
        candidate.key === "page.vue_app.ready" || candidate.key === "page.pinia_store.ready"
      );
      assert.equal(readinessFacts.length, 2);
      assert.equal(readinessFacts.every((candidate: { state: string }) => candidate.state === "blocked"), true);
    } finally {
      await running.close();
    }
  }
});

test("maps trusted BOSS login and challenge probes to blocking admission facts", async () => {
  for (const probeResult of [
    { status: "blocked" as const, failure_class: "not_logged_in" as const, message: "manual login required", verified_fact_keys: [] },
    { status: "blocked" as const, failure_class: "safety_challenge" as const, message: "challenge present", verified_fact_keys: [] }
  ]) {
    const siteProbe = trustLocalProviderSiteResourceProbe(async () => probeResult);
    const readProbe = trustLocalProviderReadProbe(async (probe) => completedBossReadProbe(probe));
    const runtime = new HarborRuntime(createBossReadLauncher(readProbe, siteProbe));
    const running = await startHarborRuntimeServer({ port: 0, runtime });
    try {
      const session = await runtime.createSession({ url: "https://www.zhipin.com/web/geek/job" });
      const facts = await getJson(`${running.url}/runtime/sessions/${session.runtime_session_ref}/site-resource-facts?site_id=boss&task_kind=job_search`);
      const key = probeResult.failure_class === "not_logged_in" ? "identity.boss_geek_logged_in.confirmed" : "safety.challenge.absent";
      const fact = facts.resource_facts.find((candidate: { key: string }) => candidate.key === key);
      assert.equal(fact.state, "blocked");
      assert.equal(fact.severity, "blocking");
      assert.equal(fact.message, probeResult.message);
    } finally {
      await running.close();
    }
  }
});

test("aborts the BOSS site-resource probe when the HTTP client disconnects", async () => {
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  let markAborted!: () => void;
  const aborted = new Promise<void>((resolve) => { markAborted = resolve; });
  let backgroundCompleted = false;
  const siteProbe = trustLocalProviderSiteResourceProbe((input) => new Promise((resolve) => {
    markStarted();
    const timer = setTimeout(() => {
      backgroundCompleted = true;
      resolve({ status: "unknown", failure_class: "provider_probe_unavailable", message: "unexpected background completion", verified_fact_keys: [] });
    }, 500);
    input.signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      markAborted();
      resolve({ status: "unknown", failure_class: "provider_probe_unavailable", message: "client disconnected", verified_fact_keys: [] });
    }, { once: true });
  }));
  const readProbe = trustLocalProviderReadProbe(async (probe) => completedBossReadProbe(probe));
  const runtime = new HarborRuntime(createBossReadLauncher(readProbe, siteProbe));
  const running = await startHarborRuntimeServer({ port: 0, runtime });
  try {
    const session = await runtime.createSession({ url: "https://www.zhipin.com/web/geek/job" });
    const target = new URL(`${running.url}/runtime/sessions/${session.runtime_session_ref}/site-resource-facts?site_id=boss&task_kind=job_search`);
    const request = httpRequest({ hostname: target.hostname, port: Number(target.port), path: `${target.pathname}${target.search}`, method: "GET" });
    request.on("error", () => undefined);
    request.end();
    await started;
    request.destroy();
    await Promise.race([aborted, new Promise((_, reject) => setTimeout(() => reject(new Error("Client disconnect did not abort site-resource probe.")), 250))]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(backgroundCompleted, false);
  } finally {
    await running.close();
  }
});

test("returns canonical public 404 session owner responses", async () => {
  const missingRuntime = new HarborRuntime(createFixtureLauncher("ready"));
  const missingServer = await startHarborRuntimeServer({ port: 0, runtime: missingRuntime });
  try {
    for (const path of ["sessions", "identity-environment-sessions"]) {
      const response = await fetch(`${missingServer.url}/runtime/${path}/session_missing`);
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), {
        schema_version: "harbor-runtime-facts/v0",
        status: "unavailable",
        failure_class: "session_missing",
        runtime_session_ref: "session_missing",
        retryable: true,
        message: "Runtime Session is missing.",
        current_error: {
          code: "session_lost",
          message: "Runtime Session is missing.",
          retryable: true
        }
      });
    }
  } finally {
    await missingServer.close();
  }

  const lostRuntime = new HarborRuntime(createFixtureLauncher("session_lost"));
  const lost = await lostRuntime.createSession();
  const lostServer = await startHarborRuntimeServer({ port: 0, runtime: lostRuntime });
  try {
    for (const path of ["sessions", "identity-environment-sessions"]) {
      const response = await fetch(`${lostServer.url}/runtime/${path}/${lost.runtime_session_ref}`);
      assert.equal(response.status, 404);
      const body = await response.json();
      assert.equal(body.schema_version, "harbor-runtime-facts/v0");
      assert.equal(body.status, "unavailable");
      assert.equal(body.failure_class, "session_lost");
      assert.equal(body.runtime_session_ref, lost.runtime_session_ref);
      assert.equal(body.retryable, true);
      assert.equal(body.message, lost.current_error?.message);
      assert.deepEqual(body.current_error, lost.current_error);
      assert.equal(JSON.stringify(body).includes("profile_ref"), false);
      assert.equal(JSON.stringify(body).includes("cdp_ref"), false);
      assert.equal(JSON.stringify(body).includes("raw_"), false);
    }
  } finally {
    await lostServer.close();
  }
});

test("serves site resource facts failures without raw browser material", async () => {
  const runtime = new HarborRuntime(createFixtureLauncher("ready"));
  const running = await startHarborRuntimeServer({ port: 0, runtime });
  try {
    const missingSession = await getJson(`${running.url}/runtime/sessions/session_missing/site-resource-facts?site_id=xiaohongshu&task_kind=search_notes`);
    assert.equal(missingSession.status, "unavailable");
    assert.equal(missingSession.failure_class, "session_missing");
    assert.equal(missingSession.public_boundary.raw_cdp_endpoint, "not_exposed");

    const session = await postJson(`${running.url}/runtime/identity-environment-sessions`, {
      identity_environment: {
        identity_environment_ref: "identity-env_challenge-test",
        execution_identity_ref: "execution-identity_challenge-test",
        profile_ref: "profile_challenge-test",
        site: {
          site_id: "boss",
          origin: "https://www.zhipin.com",
          display_name: "BOSS",
          account_ref: "account_challenge-test"
        },
        login_state: "manual_auth_required",
        storage_state: "present"
      },
      url: "https://www.zhipin.com/security/verify",
      control_owner: "agent",
      holder_ref: "server-test"
    });

    const unsupportedSite = await getJson(`${running.url}/runtime/sessions/${session.runtime_session_ref}/site-resource-facts?site_id=linkedin&task_kind=search_jobs`);
    assert.equal(unsupportedSite.status, "unavailable");
    assert.equal(unsupportedSite.failure_class, "unsupported_site");

    const unsupportedTask = await getJson(`${running.url}/runtime/sessions/${session.runtime_session_ref}/site-resource-facts?site_id=boss&task_kind=bulk_scrape`);
    assert.equal(unsupportedTask.status, "unavailable");
    assert.equal(unsupportedTask.failure_class, "unsupported_task_kind");

    const challengeFacts = await getJson(`${running.url}/runtime/sessions/${session.runtime_session_ref}/site-resource-facts?site_id=boss&task_kind=job_search`);
    const challenge = challengeFacts.resource_facts.find((fact: any) => fact.key === "safety.challenge.absent");
    assert.equal(challenge.state, "blocked");
    assert.equal(challenge.severity, "blocking");

    assert.equal(challengeFacts.public_boundary.raw_dom, "not_exposed");
    assert.equal(challengeFacts.public_boundary.raw_har, "not_exposed");
    const publicJson = JSON.stringify(challengeFacts);
    assert.equal(publicJson.includes("cookie"), false);
    assert.equal(publicJson.includes("token"), false);
    assert.equal(publicJson.includes("profile_path"), false);
    assert.equal(publicJson.includes("storage_state"), false);
  } finally {
    await running.close();
  }
});

test("returns structured failure when identity environment session has no identity input", async () => {
  const runtime = new HarborRuntime(createFixtureLauncher("ready"));
  const running = await startHarborRuntimeServer({ port: 0, runtime });
  try {
    const response = await fetch(`${running.url}/runtime/identity-environment-sessions`, {
      method: "POST",
      body: JSON.stringify({
        url: "https://example.test/runtime-api",
        control_owner: "agent"
      }),
      headers: { "content-type": "application/json", ...manualAuthHeaders() }
    });
    assert.equal(response.status, 400);
    const failure = await response.json();
    assert.equal(failure.status, "unavailable");
    assert.equal(failure.failure_class, "identity_environment_required");
    assert.equal(failure.retryable, true);
    assert.equal(failure.public_boundary.raw_material, "not_exposed");
  } finally {
    await running.close();
  }
});

test("persists identity environment public records for the local runtime API", async () => {
  const persistence_path = join(mkdtempSync(join(tmpdir(), "harbor-identity-")), "identity-environments.json");
  const first = await startHarborRuntimeServer({ port: 0, runtime: new HarborRuntime(createFixtureLauncher("ready"), { persistence_path }) });
  try {
    await postIdentityEnvironment(`${first.url}/runtime/identity-environments`, {
      identity_environment_ref: "identity-env_persisted",
      execution_identity_ref: "execution-identity_persisted",
      profile_ref: "profile_persisted",
      profile_storage_ref: "profile-storage_persisted",
      site: {
        site_id: "boss",
        origin: "https://www.zhipin.com",
        display_name: "BOSS",
        account_ref: "account_persisted"
      },
      login_state: "manual_auth_required",
      storage_state: "present",
      language: "zh-CN",
      timezone: "Asia/Shanghai",
      viewport: "1280x720"
    });
  } finally {
    await first.close();
  }

  const second = await startHarborRuntimeServer({ port: 0, runtime: new HarborRuntime(createFixtureLauncher("ready"), { persistence_path }) });
  try {
    const record = await getJson(`${second.url}/runtime/identity-environments/identity-env_persisted`);
    assert.equal(record.site.site_id, "boss");
    assert.equal(record.environment_summary.timezone, "Asia/Shanghai");
    assert.equal(record.environment_summary.viewport, "1280x720");
    assert.equal(record.public_boundary.raw_material, "not_exposed");
    assert.equal(JSON.stringify(record).includes("profile-storage_persisted"), false);
  } finally {
    await second.close();
  }
});

test("records user-confirmed manual authentication for an active managed session and persists the public record", async () => {
  const persistence_path = join(mkdtempSync(join(tmpdir(), "harbor-manual-auth-")), "identity-environments.json");
  const runtime = new HarborRuntime(createFixtureLauncher("ready"), { persistence_path });
  const first = await startHarborRuntimeServer({ port: 0, runtime, manual_authentication_supervisor_token: supervisorToken() });
  try {
    await postIdentityEnvironment(`${first.url}/runtime/identity-environments`, {
      identity_environment_ref: "identity-env_manual-auth",
      execution_identity_ref: "execution-identity_manual-auth",
      profile_ref: "profile_manual-auth",
      profile_storage_ref: "profile-storage_manual-auth-sensitive",
      cookie_jar_ref: "cookie-jar_manual-auth-sensitive",
      site: {
        site_id: "boss",
        origin: "https://www.zhipin.com",
        display_name: "BOSS",
        account_ref: "account_manual-auth"
      },
      login_state: "manual_auth_required",
      manual_authentication_state: "required",
      storage_state: "present"
    });
    const session = await postJson(`${first.url}/runtime/identity-environment-sessions`, {
      identity_environment_ref: "identity-env_manual-auth",
      url: "https://example.test/manual-authentication",
      control_owner: "user"
    });

    const untrustedResponse = await fetch(`${first.url}/runtime/sessions/${session.runtime_session_ref}/manual-authentication-completed`, { method: "POST" });
    assert.equal(untrustedResponse.status, 403);
    assert.equal((await untrustedResponse.json()).failure_class, "manual_auth_authorization_required");
    const untrustedReadback = await getJson(`${first.url}/runtime/identity-environments/identity-env_manual-auth`);
    assert.equal(untrustedReadback.status.login_state, "manual_auth_required");

    const callerOwned = await fetch(`${first.url}/runtime/sessions/${session.runtime_session_ref}/manual-authentication-completed`, {
      method: "POST",
      headers: manualAuthHeaders()
    });
    assert.equal(callerOwned.status, 409);
    assert.equal((await callerOwned.json()).failure_class, "user_confirmation_required");
    runtime.recordHandoff(session.runtime_session_ref, { control_owner: "user", handoff_reason: "login_required" });
    const response = await fetch(`${first.url}/runtime/sessions/${session.runtime_session_ref}/manual-authentication-completed`, {
      method: "POST",
      headers: manualAuthHeaders()
    });
    assert.equal(response.status, 200);
    const completed = await response.json();
    assert.equal(completed.identity_environment_ref, resolvedIdentityRef("identity-env_manual-auth"));
    assert.equal(completed.status.login_state, "logged_in");
    assert.equal(completed.status.authentication_provenance, "user_confirmed_managed_session");
    assert.equal(completed.status.manual_authentication_state, "completed");
    assert.equal(completed.status.recovery_required, false);
    assert.equal(completed.public_boundary.raw_material, "not_exposed");
    const publicJson = JSON.stringify(completed);
    assert.equal(publicJson.includes("profile-storage_manual-auth-sensitive"), false);
    assert.equal(publicJson.includes("cookie-jar_manual-auth-sensitive"), false);
    assert.equal(completed.public_boundary.not_exposed.includes("password"), true);
    assert.equal(completed.public_boundary.not_exposed.includes("verification_code"), true);
    assert.equal(publicJson.includes(supervisorToken()), false);
    assert.equal(readFileSync(persistence_path, "utf8").includes(supervisorToken()), false);
    assert.equal(JSON.stringify(await getJson(`${first.url}/ready`)).includes(supervisorToken()), false);

    const readback = await getJson(`${first.url}/runtime/identity-environments/identity-env_manual-auth`);
    assert.equal(readback.status.login_state, "logged_in");
    assert.equal(readback.status.authentication_provenance, "user_confirmed_managed_session");
    assert.equal(readback.status.manual_authentication_state, "completed");
    assert.equal(readback.status.recovery_required, false);
  } finally {
    await first.close();
  }

  const second = await startHarborRuntimeServer({ port: 0, runtime: new HarborRuntime(createFixtureLauncher("ready"), { persistence_path }) });
  try {
    const persisted = await getJson(`${second.url}/runtime/identity-environments/identity-env_manual-auth`);
    assert.equal(persisted.status.login_state, "logged_in");
    assert.equal(persisted.status.authentication_provenance, "user_confirmed_managed_session");
    assert.equal(persisted.status.manual_authentication_state, "completed");
    assert.equal(persisted.status.recovery_required, false);
  } finally {
    await second.close();
  }
});

test("keeps a confirmed headed session trusted across separately released Core read tasks", async () => {
  const runtime = new HarborRuntime(unsupportedViewerLauncher("local_provider"));
  const running = await startHarborRuntimeServer({ port: 0, runtime, manual_authentication_supervisor_token: supervisorToken() });
  try {
    await postIdentityEnvironment(`${running.url}/runtime/identity-environments`, manualAuthenticationEnvironment("identity-env_local-provider-auth"));
    const session = await postJson(`${running.url}/runtime/identity-environment-sessions`, {
      identity_environment_ref: "identity-env_local-provider-auth",
      url: "https://www.zhipin.com/web/geek/job",
      control_owner: "user"
    });
    assert.equal(session.viewer_entry.availability, "unsupported");
    assert.equal(runtime.completeManualAuthentication(session.runtime_session_ref).status, "unavailable");
    assert.equal(runtime.completeManualAuthentication(session.runtime_session_ref, {
      kind: "manual_authentication_supervisor_grant"
    }).status, "unavailable");

    const confirmed = await fetch(`${running.url}/runtime/sessions/${session.runtime_session_ref}/manual-authentication-completed`, {
      method: "POST",
      headers: manualAuthHeaders()
    });
    assert.equal(confirmed.status, 200);
    await postJson(`${running.url}/runtime/sessions/${session.runtime_session_ref}/release`, { control_owner: "user" });

    const agentClaim = await fetch(`${running.url}/runtime/identity-environment-sessions`, {
      method: "POST",
      body: JSON.stringify({
        identity_environment_ref: resolvedIdentityRef("identity-env_local-provider-auth"),
        url: "https://www.zhipin.com/web/geek/job",
        control_owner: "agent",
        reuse_existing: true
      }),
      headers: { "content-type": "application/json", ...manualAuthHeaders() }
    });
    assert.equal(agentClaim.status, 409);
    assert.equal((await agentClaim.json()).failure_class, "session_locked");

    const reused = await postJson(`${running.url}/runtime/identity-environment-sessions`, {
      identity_environment_ref: "identity-env_local-provider-auth",
      url: "https://www.zhipin.com/web/geek/job",
      control_owner: "core_task",
      reuse_existing: true
    });
    assert.equal(reused.runtime_session_ref, session.runtime_session_ref);
    const admitted = await postReadOperation(`${running.url}/runtime/sessions/${session.runtime_session_ref}/read-operations`, {
      site_id: "boss",
      operation_id: "boss_job_search",
      query: "AI tools",
      city_code: "101010100"
    });
    assert.equal(admitted.body.failure_class, "evidence_refs_missing");

    await postJson(`${running.url}/runtime/sessions/${session.runtime_session_ref}/release`, { control_owner: "core_task" });
    const locked = await postJson(`${running.url}/runtime/sessions/${session.runtime_session_ref}/lock`, {
      control_owner: "core_task",
      holder_ref: "run-detail"
    });
    assert.equal(locked.lifecycle_state, "locked");
    assert.deepEqual(locked.control_lock, {
      owner: "core_task",
      state: "held",
      holder_ref: "run-detail",
      updated_at: locked.control_lock.updated_at,
      conflict_error: null
    });
    const lockedSiteFacts = await getJson(
      `${running.url}/runtime/sessions/${session.runtime_session_ref}/site-resource-facts?site_id=boss&task_kind=job_search`
    );
    assert.equal(
      lockedSiteFacts.resource_facts.find((fact: { key: string }) => fact.key === "runtime.execution_surface.available")?.state,
      "available"
    );
    assert.match(lockedSiteFacts.snapshot_ref, /^snapshot_/);
    assert.equal(lockedSiteFacts.evidence_refs.length > 0, true);
    assert.equal(
      lockedSiteFacts.resource_facts.find((fact: { key: string }) => fact.key === "source.refs.available")?.state,
      "available"
    );
    assert.equal(
      lockedSiteFacts.resource_facts.find((fact: { key: string }) => fact.key === "evidence.snapshot_ref.available")?.state,
      "available"
    );
    await postJson(`${running.url}/runtime/sessions/${session.runtime_session_ref}/release`, {
      control_owner: "core_task",
      holder_ref: "run-detail"
    });
    await postJson(`${running.url}/runtime/identity-environment-sessions`, {
      identity_environment_ref: "identity-env_local-provider-auth",
      url: "https://www.zhipin.com/web/geek/job",
      control_owner: "core_task",
      reuse_existing: true
    });
    const second = await postReadOperation(`${running.url}/runtime/sessions/${session.runtime_session_ref}/read-operations`, {
      site_id: "boss",
      operation_id: "boss_job_search",
      query: "AI tools",
      city_code: "101010100"
    });
    assert.equal(second.body.failure_class, "evidence_refs_missing");
    await postJson(`${running.url}/runtime/sessions/${session.runtime_session_ref}/release`, { control_owner: "core_task" });

    const userClaim = await fetch(`${running.url}/runtime/identity-environment-sessions`, {
      method: "POST",
      body: JSON.stringify({
        identity_environment_ref: resolvedIdentityRef("identity-env_local-provider-auth"),
        url: "https://www.zhipin.com/web/geek/job",
        control_owner: "user",
        reuse_existing: true
      }),
      headers: { "content-type": "application/json", ...manualAuthHeaders() }
    });
    assert.equal(userClaim.status, 409);
    assert.equal((await userClaim.json()).failure_class, "session_locked");
  } finally {
    await running.close();
  }
});

test("never reuses a released headless user-action session for manual visibility but preserves headed Core handoff", async () => {
  const launches: LocalProviderLaunchInput[] = [];
  const closes: string[] = [];
  const fixture = createFixtureLauncher("ready");
  const runtime = new HarborRuntime(async (input) => {
    launches.push({ ...input });
    const launch = await fixture(input);
    if (launch.status !== "ready") return launch;
    return {
      ...launch,
      execution_surface: "local_provider",
      close: async () => { closes.push(input.profile_ref); }
    };
  });
  const running = await startHarborRuntimeServer({ port: 0, runtime, manual_authentication_supervisor_token: supervisorToken() });
  try {
    await postIdentityEnvironment(`${running.url}/runtime/identity-environments`, manualAuthenticationEnvironment("identity-env_visibility-handoff"));
    const core = await postJson(`${running.url}/runtime/identity-environment-sessions`, {
      identity_environment_ref: "identity-env_visibility-handoff",
      url: "https://www.zhipin.com/web/geek/job",
      control_owner: "core_task"
    });
    assert.equal(launches[0]?.headless, true);
    runtime.recordHandoff(core.runtime_session_ref, { control_owner: "user", handoff_reason: "login_required" });
    const confirmedCore = await fetch(`${running.url}/runtime/sessions/${core.runtime_session_ref}/manual-authentication-completed`, {
      method: "POST",
      headers: manualAuthHeaders()
    });
    assert.equal(confirmedCore.status, 200);
    await postJson(`${running.url}/runtime/sessions/${core.runtime_session_ref}/release`, { control_owner: "user" });

    const manual = await postJson(`${running.url}/runtime/identity-environment-sessions`, {
      identity_environment_ref: "identity-env_visibility-handoff",
      url: "https://www.zhipin.com/web/geek/job",
      control_owner: "user"
    });
    assert.notEqual(manual.runtime_session_ref, core.runtime_session_ref);
    assert.deepEqual(launches.map((launch) => launch.headless), [true, false]);
    assert.equal(manual.control_owner, "user");
    assert.equal(manual.availability.viewer, "available");
    assert.equal(manual.viewer_entry.transport, "local_window");
    assert.equal(runtime.getSession(core.runtime_session_ref)?.lifecycle_state, "closed");
    assert.equal(closes.length, 1);

    const confirmedManual = await fetch(`${running.url}/runtime/sessions/${manual.runtime_session_ref}/manual-authentication-completed`, {
      method: "POST",
      headers: manualAuthHeaders()
    });
    assert.equal(confirmedManual.status, 200);
    await postJson(`${running.url}/runtime/sessions/${manual.runtime_session_ref}/release`, { control_owner: "user" });
    const handedToCore = await postJson(`${running.url}/runtime/identity-environment-sessions`, {
      identity_environment_ref: "identity-env_visibility-handoff",
      url: "https://www.zhipin.com/web/geek/job",
      control_owner: "core_task"
    });
    assert.equal(handedToCore.runtime_session_ref, manual.runtime_session_ref);
    assert.equal(handedToCore.availability.viewer, "available");
    assert.equal(handedToCore.control_owner, "core_task");
    assert.equal(launches.length, 2);
    assert.equal(closes.length, 1);
  } finally {
    await running.close();
  }
});

test("rebinds persisted user-confirmed authentication to a fresh headed session before Core handoff", async () => {
  const persistence_path = join(mkdtempSync(join(tmpdir(), "harbor-persisted-headed-handoff-")), "identity-environments.json");
  const first = await startHarborRuntimeServer({
    port: 0,
    runtime: new HarborRuntime(unsupportedViewerLauncher("local_provider"), { persistence_path }),
    manual_authentication_supervisor_token: supervisorToken()
  });
  try {
    await postIdentityEnvironment(`${first.url}/runtime/identity-environments`, manualAuthenticationEnvironment("identity-env_persisted-headed-handoff"));
    const initial = await postJson(`${first.url}/runtime/identity-environment-sessions`, {
      identity_environment_ref: "identity-env_persisted-headed-handoff",
      url: "https://www.zhipin.com/web/geek/job",
      control_owner: "user"
    });
    const confirmed = await fetch(`${first.url}/runtime/sessions/${initial.runtime_session_ref}/manual-authentication-completed`, {
      method: "POST",
      headers: manualAuthHeaders()
    });
    assert.equal(confirmed.status, 200);
  } finally {
    await first.close();
  }

  const launches: LocalProviderLaunchInput[] = [];
  const fixture = createFixtureLauncher("ready");
  const secondRuntime = new HarborRuntime(async (input) => {
    launches.push({ ...input });
    const launch = await fixture(input);
    return launch.status === "ready" ? { ...launch, execution_surface: "local_provider" } : launch;
  }, { persistence_path });
  const second = await startHarborRuntimeServer({ port: 0, runtime: secondRuntime });
  try {
    const manual = await postJson(`${second.url}/runtime/identity-environment-sessions`, {
      identity_environment_ref: "identity-env_persisted-headed-handoff",
      url: "https://www.zhipin.com/web/geek/job",
      control_owner: "user"
    });
    assert.equal(launches[0]?.headless, false);
    await postJson(`${second.url}/runtime/sessions/${manual.runtime_session_ref}/release`, { control_owner: "user" });

    const core = await postJson(`${second.url}/runtime/identity-environment-sessions`, {
      identity_environment_ref: "identity-env_persisted-headed-handoff",
      url: "https://www.zhipin.com/web/geek/job?query=frontend",
      control_owner: "core_task"
    });
    assert.equal(core.runtime_session_ref, manual.runtime_session_ref);
    assert.equal(core.control_owner, "core_task");
    assert.equal(core.viewer_entry.transport, "local_window");
    assert.equal(launches.length, 1);
  } finally {
    await second.close();
  }
});

test("rejects direct user confirmation for fixture, unknown, and non-user local-provider sessions", async () => {
  for (const [surface, owner] of [["fixture", "user"], [undefined, "user"], ["local_provider", "agent"]] as const) {
    const runtime = new HarborRuntime(unsupportedViewerLauncher(surface));
    const running = await startHarborRuntimeServer({ port: 0, runtime, manual_authentication_supervisor_token: supervisorToken() });
    try {
      const identityEnvironmentRef = `identity-env_rejected-${surface ?? "unknown"}-${owner}`;
      await postIdentityEnvironment(`${running.url}/runtime/identity-environments`, manualAuthenticationEnvironment(identityEnvironmentRef));
      const session = await postJson(`${running.url}/runtime/identity-environment-sessions`, {
        identity_environment_ref: identityEnvironmentRef,
        url: "https://www.zhipin.com/",
        control_owner: owner
      });
      const response = await fetch(`${running.url}/runtime/sessions/${session.runtime_session_ref}/manual-authentication-completed`, {
        method: "POST",
        headers: manualAuthHeaders()
      });
      assert.equal(response.status, 409);
      assert.equal((await response.json()).failure_class, "user_confirmation_required");
    } finally {
      await running.close();
    }
  }
});

test("fails closed before session lookup and requires one valid fixed-format supervisor credential", async () => {
  const runtime = new HarborRuntime(createFixtureLauncher("ready"));
  const unavailable = await startUnconfiguredHarborRuntimeServer({ port: 0, runtime });
  try {
    for (const runtimeSessionRef of ["session_missing", "session_not_inspected"]) {
      const response = await fetch(`${unavailable.url}/runtime/sessions/${runtimeSessionRef}/manual-authentication-completed`, { method: "POST" });
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { failure_class: "manual_auth_authorization_unavailable" });
    }
    const coreControl = await fetch(`${unavailable.url}/runtime/identity-environment-sessions`, {
      method: "POST",
      body: JSON.stringify({ identity_environment_ref: "identity-env_missing", control_owner: "core_task" }),
      headers: { "content-type": "application/json" }
    });
    assert.equal(coreControl.status, 503);
    assert.deepEqual(await coreControl.json(), { failure_class: "manual_auth_authorization_unavailable" });
  } finally {
    await unavailable.close();
  }

  const configured = await startHarborRuntimeServer({
    port: 0,
    runtime,
    manual_authentication_supervisor_token: supervisorToken()
  });
  try {
    await postIdentityEnvironment(`${configured.url}/runtime/identity-environments`, manualAuthenticationEnvironment("identity-env_authorization"));
    const session = await postJson(`${configured.url}/runtime/identity-environment-sessions`, {
      identity_environment_ref: "identity-env_authorization",
      url: "https://example.test/authorization",
      control_owner: "user"
    });
    runtime.recordHandoff(session.runtime_session_ref, { control_owner: "user", handoff_reason: "login_required" });
    const before = await getJson(`${configured.url}/runtime/identity-environments/identity-env_authorization`);

    const rejectedHeaders: Record<string, string>[] = [{}, { authorization: "Bearer invalid" }, { authorization: `Bearer ${differentSupervisorToken()}` }];
    for (const headers of rejectedHeaders) {
      const [known, unknown] = await Promise.all([
        fetch(`${configured.url}/runtime/sessions/${session.runtime_session_ref}/manual-authentication-completed`, { method: "POST", headers }),
        fetch(`${configured.url}/runtime/sessions/session_not_inspected/manual-authentication-completed`, { method: "POST", headers })
      ]);
      assert.equal(known.status, 403);
      assert.equal(unknown.status, 403);
      assert.deepEqual(await known.json(), await unknown.json());
      assert.deepEqual(await getJson(`${configured.url}/runtime/identity-environments/identity-env_authorization`), before);
    }

    const duplicate = await postDuplicateAuthorization(
      `${configured.url}/runtime/sessions/${session.runtime_session_ref}/manual-authentication-completed`,
      supervisorToken()
    );
    assert.equal(duplicate.status, 403);
    assert.deepEqual(duplicate.body, { failure_class: "manual_auth_authorization_required" });
    assert.deepEqual(await getJson(`${configured.url}/runtime/identity-environments/identity-env_authorization`), before);

    for (const request of [
      fetch(`${configured.url}/runtime/sessions/${session.runtime_session_ref}/manual-authentication-completed?token=${supervisorToken()}`, {
        method: "POST",
        headers: manualAuthHeaders()
      }),
      fetch(`${configured.url}/runtime/sessions/${session.runtime_session_ref}/manual-authentication-completed`, {
        method: "POST",
        headers: { ...manualAuthHeaders(), "content-type": "application/json" },
        body: "{}"
      })
    ]) {
      const response = await request;
      assert.equal(response.status, 400);
      assert.deepEqual(await getJson(`${configured.url}/runtime/identity-environments/identity-env_authorization`), before);
    }
  } finally {
    await configured.close();
  }
});

test("requires the supervisor bearer for Core control routes", async () => {
  const runtime = new HarborRuntime(createFixtureLauncher("ready"));
  const running = await startHarborRuntimeServer({ port: 0, runtime });
  try {
    await postIdentityEnvironment(`${running.url}/runtime/identity-environments`, manualAuthenticationEnvironment("identity-env_core-control"));
    const request = {
      identity_environment_ref: "identity-env_core-control",
      url: "https://www.zhipin.com/web/geek/job",
      control_owner: "core_task"
    };
    const unauthorizedOpen = await fetch(`${running.url}/runtime/identity-environment-sessions`, {
      method: "POST",
      body: JSON.stringify(request),
      headers: { "content-type": "application/json" }
    });
    assert.equal(unauthorizedOpen.status, 403);
    assert.deepEqual(await unauthorizedOpen.json(), { failure_class: "manual_auth_authorization_required" });

    const session = await postJson(`${running.url}/runtime/identity-environment-sessions`, request);
    for (const [path, body] of [
      [`/runtime/sessions/${session.runtime_session_ref}/release`, { control_owner: "core_task" }],
      [`/runtime/sessions/${session.runtime_session_ref}/read-operations`, { site_id: "boss", operation_id: "boss_job_search", query: "AI", city_code: "101010100" }]
    ] as const) {
      const response = await fetch(`${running.url}${path}`, {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" }
      });
      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), { failure_class: "manual_auth_authorization_required" });
    }
  } finally {
    await running.close();
  }
});

test("rejects missing, unmanaged, closed, and failed sessions without changing identity state", async () => {
  const runtime = new HarborRuntime(createFixtureLauncher("ready"));
  const running = await startHarborRuntimeServer({ port: 0, runtime, manual_authentication_supervisor_token: supervisorToken() });
  try {
    await postIdentityEnvironment(`${running.url}/runtime/identity-environments`, {
      identity_environment_ref: "identity-env_manual-auth-reject",
      execution_identity_ref: "execution-identity_manual-auth-reject",
      profile_ref: "profile_manual-auth-reject",
      site: {
        site_id: "boss",
        origin: "https://www.zhipin.com",
        display_name: "BOSS"
      },
      login_state: "manual_auth_required",
      manual_authentication_state: "required",
      storage_state: "present"
    });

    const missing = await fetch(`${running.url}/runtime/sessions/session_missing/manual-authentication-completed`, { method: "POST", headers: manualAuthHeaders() });
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).failure_class, "session_missing");

    const unmanaged = await postJson(`${running.url}/runtime/identity-environment-sessions`, {
      identity_environment: {
        identity_environment_ref: "identity-env_inline-unmanaged",
        execution_identity_ref: "execution-identity_inline-unmanaged",
        profile_ref: "profile_inline-unmanaged",
        site: { site_id: "boss", origin: "https://www.zhipin.com", display_name: "BOSS" },
        login_state: "manual_auth_required",
        storage_state: "present"
      },
      url: "https://example.test/unmanaged",
      control_owner: "user"
    });
    runtime.recordHandoff(unmanaged.runtime_session_ref, { control_owner: "user", handoff_reason: "login_required" });
    const unmanagedResponse = await fetch(`${running.url}/runtime/sessions/${unmanaged.runtime_session_ref}/manual-authentication-completed`, { method: "POST", headers: manualAuthHeaders() });
    assert.equal(unmanagedResponse.status, 409);
    assert.equal((await unmanagedResponse.json()).failure_class, "identity_environment_unmanaged");

    await postIdentityEnvironment(`${running.url}/runtime/identity-environments`, {
      identity_environment_ref: "identity-env_manual-auth-agent",
      execution_identity_ref: "execution-identity_manual-auth-agent",
      profile_ref: "profile_manual-auth-agent",
      site: { site_id: "boss", origin: "https://www.zhipin.com", display_name: "BOSS" },
      login_state: "manual_auth_required",
      storage_state: "present"
    });
    const agentSession = await postJson(`${running.url}/runtime/identity-environment-sessions`, {
      identity_environment_ref: "identity-env_manual-auth-agent",
      url: "https://example.test/agent",
      control_owner: "agent"
    });
    const agentResponse = await fetch(`${running.url}/runtime/sessions/${agentSession.runtime_session_ref}/manual-authentication-completed`, { method: "POST", headers: manualAuthHeaders() });
    assert.equal(agentResponse.status, 409);
    assert.equal((await agentResponse.json()).failure_class, "user_confirmation_required");

    const closed = await postJson(`${running.url}/runtime/identity-environment-sessions`, {
      identity_environment_ref: "identity-env_manual-auth-reject",
      url: "https://example.test/closed"
    });
    await postJson(`${running.url}/runtime/sessions/${closed.runtime_session_ref}/stop`, { control_owner: "agent" });
    const closedResponse = await fetch(`${running.url}/runtime/sessions/${closed.runtime_session_ref}/manual-authentication-completed`, { method: "POST", headers: manualAuthHeaders() });
    assert.equal(closedResponse.status, 409);
    assert.equal((await closedResponse.json()).failure_class, "session_not_active");

    const failedRuntime = new HarborRuntime(createFixtureLauncher("unavailable"));
    failedRuntime.createLocalIdentityEnvironment({
      identity_environment_ref: "identity-env_failed",
      execution_identity_ref: "execution-identity_failed",
      profile_ref: "profile_failed",
      site: { site_id: "boss", origin: "https://www.zhipin.com", display_name: "BOSS" },
      login_state: "manual_auth_required",
      storage_state: "present"
    });
    const failedServer = await startHarborRuntimeServer({
      port: 0,
      runtime: failedRuntime,
      manual_authentication_supervisor_token: supervisorToken()
    });
    try {
      const failed = await postJson(`${failedServer.url}/runtime/identity-environment-sessions`, {
        identity_environment_ref: "identity-env_failed",
        url: "https://example.test/failed"
      });
      assert.equal(failed.lifecycle_state, "failed");
      const failedResponse = await fetch(`${failedServer.url}/runtime/sessions/${failed.runtime_session_ref}/manual-authentication-completed`, { method: "POST", headers: manualAuthHeaders() });
      assert.equal(failedResponse.status, 409);
      assert.equal((await failedResponse.json()).failure_class, "session_not_active");
      const failedReadback = await getJson(`${failedServer.url}/runtime/identity-environments/identity-env_failed`);
      assert.equal(failedReadback.status.login_state, "manual_auth_required");
    } finally {
      await failedServer.close();
    }

    const unchanged = await getJson(`${running.url}/runtime/identity-environments/identity-env_manual-auth-reject`);
    assert.equal(unchanged.status.login_state, "manual_auth_required");
    assert.equal(unchanged.status.manual_authentication_state, "required");
    assert.equal(unchanged.status.recovery_required, true);
  } finally {
    await running.close();
  }
});

test("ignores caller-supplied owner refs when creating identities through the compatibility route", async () => {
  const runtime = new HarborRuntime(createFixtureLauncher("ready"));
  const running = await startHarborRuntimeServer({ port: 0, runtime, manual_authentication_supervisor_token: supervisorToken() });
  try {
    const first = await postIdentityEnvironment(`${running.url}/runtime/identity-environments`, {
      identity_environment_ref: "identity-env_same-profile-a",
      execution_identity_ref: "identity-env_same-profile-a:execution",
      profile_ref: "profile_same-profile",
      site: { site_id: "xiaohongshu", origin: "https://www.xiaohongshu.com", display_name: "小红书" }
    });
    const duplicate = await fetch(`${running.url}/runtime/identity-environments`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "same-profile-b", ...manualAuthHeaders() },
      body: JSON.stringify({
        identity_environment_ref: "identity-env_same-profile-b",
        execution_identity_ref: "identity-env_same-profile-b:execution",
        profile_ref: "profile_same-profile",
        site: { site_id: "xiaohongshu", origin: "https://www.xiaohongshu.com", display_name: "小红书" }
      })
    });
    assert.equal(duplicate.status, 201);
    const second = await duplicate.json();
    assert.notEqual(second.identity_environment_ref, "identity-env_same-profile-b");
    assert.notEqual(second.identity_environment_ref, first.identity_environment_ref);
    assert.notEqual(second.record.refs.profile_ref, first.record.refs.profile_ref);
  } finally {
    await running.close();
  }
});

test("does not reuse or confirm a session with a different execution identity", async () => {
  const runtime = new HarborRuntime(createFixtureLauncher("ready"));
  const running = await startHarborRuntimeServer({ port: 0, runtime, manual_authentication_supervisor_token: supervisorToken() });
  try {
    await postIdentityEnvironment(`${running.url}/runtime/identity-environments`, {
      identity_environment_ref: "identity-env_execution-boundary",
      execution_identity_ref: "execution-identity_a",
      profile_ref: "profile_execution-boundary",
      site: { site_id: "boss", origin: "https://www.zhipin.com", display_name: "BOSS" },
      login_state: "manual_auth_required",
      storage_state: "present"
    });
    const first = await postJson(`${running.url}/runtime/identity-environment-sessions`, {
      identity_environment_ref: "identity-env_execution-boundary",
      url: "https://example.test/execution-identity-a",
      control_owner: "user"
    });
    const second = await postJson(`${running.url}/runtime/identity-environment-sessions`, {
      identity_environment: {
        identity_environment_ref: "identity-env_execution-boundary",
        execution_identity_ref: "execution-identity_b",
        profile_ref: "profile_execution-boundary",
        site: { site_id: "boss", origin: "https://www.zhipin.com", display_name: "BOSS" },
        login_state: "manual_auth_required",
        storage_state: "present"
      },
      url: "https://example.test/execution-identity-b",
      control_owner: "user"
    });
    assert.notEqual(first.runtime_session_ref, second.runtime_session_ref);
    assert.equal(second.execution_identity_ref, "execution-identity_b");

    runtime.recordHandoff(second.runtime_session_ref, { control_owner: "user", handoff_reason: "login_required" });
    const response = await fetch(`${running.url}/runtime/sessions/${second.runtime_session_ref}/manual-authentication-completed`, { method: "POST", headers: manualAuthHeaders() });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).failure_class, "identity_environment_unmanaged");
    const managedIdentity = await getJson(`${running.url}/runtime/identity-environments/identity-env_execution-boundary`);
    assert.equal(managedIdentity.status.login_state, "manual_auth_required");
  } finally {
    await running.close();
  }
});

test("rejects manual authentication when a session differs from the managed profile and storage binding", async () => {
  const runtime = new HarborRuntime(createFixtureLauncher("ready"));
  const running = await startHarborRuntimeServer({ port: 0, runtime, manual_authentication_supervisor_token: supervisorToken() });
  try {
    await postIdentityEnvironment(`${running.url}/runtime/identity-environments`, {
      identity_environment_ref: "identity-env_profile-storage-boundary",
      execution_identity_ref: "execution-identity_profile-storage-boundary",
      profile_ref: "profile_canonical",
      profile_storage_ref: "profile-storage_canonical",
      site: { site_id: "boss", origin: "https://www.zhipin.com", display_name: "BOSS" },
      login_state: "manual_auth_required",
      storage_state: "present"
    });
    const session = await postJson(`${running.url}/runtime/identity-environment-sessions`, {
      identity_environment: {
        identity_environment_ref: "identity-env_profile-storage-boundary",
        execution_identity_ref: "execution-identity_profile-storage-boundary",
        profile_ref: "profile_different",
        profile_storage_ref: "profile-storage_different",
        site: { site_id: "boss", origin: "https://www.zhipin.com", display_name: "BOSS" },
        login_state: "manual_auth_required",
        storage_state: "present"
      },
      url: "https://example.test/profile-storage-boundary",
      control_owner: "user"
    });

    runtime.recordHandoff(session.runtime_session_ref, { control_owner: "user", handoff_reason: "login_required" });
    const response = await fetch(`${running.url}/runtime/sessions/${session.runtime_session_ref}/manual-authentication-completed`, { method: "POST", headers: manualAuthHeaders() });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).failure_class, "identity_environment_unmanaged");
    const unchanged = await getJson(`${running.url}/runtime/identity-environments/identity-env_profile-storage-boundary`);
    assert.equal(unchanged.status.login_state, "manual_auth_required");
    assert.equal(unchanged.status.authentication_provenance, "unknown");
  } finally {
    await running.close();
  }
});

test("does not publish a confirmed login state when identity persistence fails", async () => {
  let persistenceWrites = 0;
  let state: IdentityEnvironmentMutationPersistenceState | null = null;
  const runtime = new HarborRuntime(createFixtureLauncher("ready"), {
    load_state: () => state,
    persist_state: (next) => {
      persistenceWrites += 1;
      if (persistenceWrites > 2) throw new Error("simulated persistence failure at /private/identity-environments.json");
      state = structuredClone(next);
    }
  });
  const running = await startHarborRuntimeServer({ port: 0, runtime, manual_authentication_supervisor_token: supervisorToken() });
  try {
    await postIdentityEnvironment(`${running.url}/runtime/identity-environments`, {
      identity_environment_ref: "identity-env_persist-failure",
      execution_identity_ref: "execution-identity_persist-failure",
      profile_ref: "profile_persist-failure",
      site: { site_id: "boss", origin: "https://www.zhipin.com", display_name: "BOSS" },
      login_state: "manual_auth_required",
      storage_state: "present"
    });
    const session = await postJson(`${running.url}/runtime/identity-environment-sessions`, {
      identity_environment_ref: "identity-env_persist-failure",
      url: "https://example.test/persist-failure",
      control_owner: "user"
    });
    runtime.recordHandoff(session.runtime_session_ref, { control_owner: "user", handoff_reason: "login_required" });
    const response = await fetch(`${running.url}/runtime/sessions/${session.runtime_session_ref}/manual-authentication-completed`, { method: "POST", headers: manualAuthHeaders() });
    assert.equal(response.status, 500);
    const failure = await response.json();
    assert.equal(failure.error, "internal_error");
    assert.equal(failure.message, "Internal Harbor Runtime API error.");
    assert.equal(JSON.stringify(failure).includes("simulated persistence failure"), false);
    assert.equal(JSON.stringify(failure).includes("/private/identity-environments.json"), false);
    const readback = await getJson(`${running.url}/runtime/identity-environments/identity-env_persist-failure`);
    assert.equal(readback.status.login_state, "manual_auth_required");
    assert.equal(readback.status.authentication_provenance, "unknown");
  } finally {
    await running.close();
  }
});

test("rejects every fixture-backed allowlisted read operation without leaking protected material", async () => {
  const runtime = new HarborRuntime(createFixtureLauncher("ready"));
  const running = await startHarborRuntimeServer({ port: 0, runtime });
  try {
    await postIdentityEnvironment(`${running.url}/runtime/identity-environments`, {
      identity_environment_ref: "identity-env_read-operation-fixture",
      execution_identity_ref: "execution-identity_read-operation-fixture",
      profile_ref: "profile_read-operation-fixture",
      profile_storage_ref: "profile-storage_read-operation-fixture",
      site: { site_id: "xiaohongshu", origin: "https://www.xiaohongshu.com", display_name: "小红书" },
      login_state: "logged_in",
      storage_state: "present"
    });
    const session = await postJson(`${running.url}/runtime/identity-environment-sessions`, {
      identity_environment_ref: "identity-env_read-operation-fixture",
      url: "https://www.xiaohongshu.com/explore",
      control_owner: "user"
    });
    assert.equal(runtime.completeManualAuthentication(session.runtime_session_ref).status, "unavailable");
    runtime.recordHandoff(session.runtime_session_ref, { control_owner: "user", handoff_reason: "login_required" });
    assert.ok(runtime.completeManualAuthentication(session.runtime_session_ref));
    runtime.recordHandoff(session.runtime_session_ref, { control_owner: "core_task", handoff_reason: "user_requested" });

    const invalid = await postReadOperation(`${running.url}/runtime/sessions/${session.runtime_session_ref}/read-operations`, {
      site_id: "xiaohongshu",
      operation_id: "xhs_search_notes",
      operation_mode: "write"
    });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.failure_class, "invalid_request");

    const crossOrigin = await postReadOperation(`${running.url}/runtime/sessions/${session.runtime_session_ref}/read-operations`, {
      site_id: "xiaohongshu",
      operation_id: "xhs_search_notes",
      query: "AI tools",
      url: "https://attacker.example/read"
    });
    assert.equal(crossOrigin.status, 400);
    assert.equal(crossOrigin.body.failure_class, "target_origin_not_allowed");

    const fixture = await postReadOperation(`${running.url}/runtime/sessions/${session.runtime_session_ref}/read-operations`, {
      site_id: "xiaohongshu",
      operation_id: "xhs_search_notes",
      query: "AI tools"
    });
    assert.equal(fixture.status, 409);
    assert.equal(fixture.body.status, "unavailable");
    assert.equal(fixture.body.failure_class, "fixture_runtime");
    const publicJson = JSON.stringify(fixture.body);
    assert.equal(publicJson.includes("profile-storage_read-operation-fixture"), false);
    assert.equal(publicJson.includes("Cookie"), false);
    assert.equal(publicJson.includes("token"), false);
    assert.equal(publicJson.includes("webSocketDebuggerUrl"), false);
  } finally {
    await running.close();
  }
});

test("blocks an allowlisted read operation before provider execution when the managed identity needs login", async () => {
  const runtime = new HarborRuntime(createFixtureLauncher("ready"));
  const running = await startHarborRuntimeServer({ port: 0, runtime });
  try {
    await postIdentityEnvironment(`${running.url}/runtime/identity-environments`, {
      identity_environment_ref: "identity-env_read-operation-login",
      execution_identity_ref: "execution-identity_read-operation-login",
      profile_ref: "profile_read-operation-login",
      profile_storage_ref: "profile-storage_read-operation-login",
      site: { site_id: "boss", origin: "https://www.zhipin.com", display_name: "BOSS" },
      login_state: "manual_auth_required",
      storage_state: "present"
    });
    const session = await postJson(`${running.url}/runtime/identity-environment-sessions`, {
      identity_environment_ref: "identity-env_read-operation-login",
      url: "https://www.zhipin.com/",
      control_owner: "agent"
    });
    const blocked = await postReadOperation(`${running.url}/runtime/sessions/${session.runtime_session_ref}/read-operations`, {
      site_id: "boss",
      operation_id: "boss_job_search",
      query: "AI tools",
      city_code: "101010100"
    });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.failure_class, "not_logged_in");
  } finally {
    await running.close();
  }
});

test("validates a persisted login through the real read probe without requiring a current session provenance", async () => {
  for (const probeResult of [
    { kind: "completed" as const },
    { kind: "blocked" as const, failure_class: "not_logged_in" as const }
  ]) {
    let probeCalls = 0;
    const probe = trustLocalProviderReadProbe(async (input) => {
      probeCalls += 1;
      return probeResult.kind === "completed"
        ? completedBossReadProbe(input)
        : { status: "unavailable", failure_class: probeResult.failure_class, message: "login is not valid on the live page", retryable: true };
    });
    const runtime = new HarborRuntime(createBossReadLauncher(probe));
    runtime.createLocalIdentityEnvironment({
      identity_environment_ref: `identity-env_persisted-${probeResult.kind}`,
      execution_identity_ref: `execution-identity_persisted-${probeResult.kind}`,
      profile_ref: `profile_persisted-${probeResult.kind}`,
      profile_storage_ref: `profile-storage_persisted-${probeResult.kind}`,
      site: { site_id: "boss", origin: "https://www.zhipin.com", display_name: "BOSS" },
      login_state: "logged_in",
      manual_authentication_state: "completed",
      storage_state: "present"
    });
    const running = await startHarborRuntimeServer({ port: 0, runtime });
    try {
      const session = await postJson(`${running.url}/runtime/identity-environment-sessions`, {
        identity_environment_ref: `identity-env_persisted-${probeResult.kind}`,
        url: "https://www.zhipin.com/web/geek/job",
        control_owner: "core_task"
      });
      const response = await postReadOperation(`${running.url}/runtime/sessions/${session.runtime_session_ref}/read-operations`, {
        site_id: "boss",
        operation_id: "boss_job_search",
        query: "AI tools",
        city_code: "101010100"
      });
      assert.equal(probeCalls, 1);
      assert.equal(response.status, probeResult.kind === "completed" ? 201 : 409);
      if (probeResult.kind === "blocked") assert.equal(response.body.failure_class, "not_logged_in");
    } finally {
      await running.close();
    }
  }
});

test("rejects an injected local-provider probe rather than minting a completed read operation", async () => {
  const runtime = new HarborRuntime(successfulBossReadLauncher);
  const running = await startHarborRuntimeServer({ port: 0, runtime });
  try {
    await postIdentityEnvironment(`${running.url}/runtime/identity-environments`, {
      identity_environment_ref: "identity-env_read-operation-success",
      execution_identity_ref: "execution-identity_read-operation-success",
      profile_ref: "profile_read-operation-success",
      profile_storage_ref: "profile-storage_read-operation-success",
      site: { site_id: "boss", origin: "https://www.zhipin.com", display_name: "BOSS" },
      login_state: "logged_in",
      storage_state: "present"
    });
    const session = await postJson(`${running.url}/runtime/identity-environment-sessions`, {
      identity_environment_ref: "identity-env_read-operation-success",
      url: "https://www.zhipin.com/web/geek/job",
      control_owner: "user"
    });
    assert.equal(runtime.completeManualAuthentication(session.runtime_session_ref).status, "unavailable");
    runtime.recordHandoff(session.runtime_session_ref, { control_owner: "user", handoff_reason: "login_required" });
    assert.ok(runtime.completeManualAuthentication(session.runtime_session_ref));
    runtime.recordHandoff(session.runtime_session_ref, { control_owner: "core_task", handoff_reason: "user_requested" });
    const response = await postReadOperation(`${running.url}/runtime/sessions/${session.runtime_session_ref}/read-operations`, {
      site_id: "boss",
      operation_id: "boss_job_search",
      query: "AI tools",
      city_code: "101010100"
    });
    assert.equal(response.status, 409);
    assert.equal(response.body.status, "unavailable");
    assert.equal(response.body.failure_class, "evidence_refs_missing");
    assert.equal(successfulBossProbeCalls, 0);
  } finally {
    await running.close();
  }
});

test("fails closed when session control is released while a trusted read probe is pending", async () => {
  const deferredProbe: { finish?: () => void } = {};
  let markProbeStarted!: () => void;
  const probeStarted = new Promise<void>((resolve) => { markProbeStarted = resolve; });
  const probe = trustLocalProviderReadProbe((input) => new Promise((resolve) => {
    markProbeStarted();
    deferredProbe.finish = () => resolve(completedBossReadProbe(input));
  }));
  const runtime = new HarborRuntime(createBossReadLauncher(probe));
  const running = await startHarborRuntimeServer({ port: 0, runtime });
  try {
    await postIdentityEnvironment(`${running.url}/runtime/identity-environments`, {
      identity_environment_ref: "identity-env_read-operation-race",
      execution_identity_ref: "execution-identity_read-operation-race",
      profile_ref: "profile_read-operation-race",
      profile_storage_ref: "profile-storage_read-operation-race",
      site: { site_id: "boss", origin: "https://www.zhipin.com", display_name: "BOSS" },
      login_state: "logged_in",
      storage_state: "present"
    });
    const session = await postJson(`${running.url}/runtime/identity-environment-sessions`, {
      identity_environment_ref: "identity-env_read-operation-race",
      url: "https://www.zhipin.com/web/geek/job",
      control_owner: "user"
    });
    runtime.recordHandoff(session.runtime_session_ref, { control_owner: "user", handoff_reason: "login_required" });
    assert.ok(runtime.completeManualAuthentication(session.runtime_session_ref));
    runtime.recordHandoff(session.runtime_session_ref, { control_owner: "core_task", handoff_reason: "user_requested" });

    const pendingRead = postReadOperation(`${running.url}/runtime/sessions/${session.runtime_session_ref}/read-operations`, {
      site_id: "boss",
      operation_id: "boss_job_search",
      query: "AI tools",
      city_code: "101010100"
    });
    await probeStarted;
    runtime.releaseSession(session.runtime_session_ref, { control_owner: "core_task" });
    assert.ok(deferredProbe.finish);
    deferredProbe.finish();

    const response = await pendingRead;
    assert.equal(response.status, 409);
    assert.equal(response.body.failure_class, "session_user_controlled");
  } finally {
    await running.close();
  }
});

test("fails closed before probing when PATCH login state or release lacks a confirmed held controller", async () => {
  successfulBossProbeCalls = 0;
  const runtime = new HarborRuntime(successfulBossReadLauncher);
  const running = await startHarborRuntimeServer({ port: 0, runtime });
  try {
    await postIdentityEnvironment(`${running.url}/runtime/identity-environments`, {
      identity_environment_ref: "identity-env_read-operation-bypass",
      execution_identity_ref: "execution-identity_read-operation-bypass",
      profile_ref: "profile_read-operation-bypass",
      profile_storage_ref: "profile-storage_read-operation-bypass",
      site: { site_id: "boss", origin: "https://www.zhipin.com", display_name: "BOSS" },
      login_state: "manual_auth_required",
      storage_state: "present"
    });
    const patchedSession = await postJson(`${running.url}/runtime/identity-environment-sessions`, {
      identity_environment_ref: "identity-env_read-operation-bypass",
      url: "https://www.zhipin.com/web/geek/job",
      control_owner: "agent"
    });
    const patched = await fetch(`${running.url}/runtime/identity-environments/identity-env_read-operation-bypass`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "idempotency-key": "patch-login-bypass", ...manualAuthHeaders() },
      body: JSON.stringify({ login_state: "logged_in", manual_authentication_state: "completed" })
    });
    assert.equal(patched.status, 400);
    const patchedRead = await postReadOperation(`${running.url}/runtime/sessions/${patchedSession.runtime_session_ref}/read-operations`, {
      site_id: "boss",
      operation_id: "boss_job_search",
      query: "AI tools",
      city_code: "101010100"
    });
    assert.equal(patchedRead.status, 409);
    assert.equal(patchedRead.body.failure_class, "not_logged_in");
    const stoppedPatchedSession = await runtime.stopSession(patchedSession.runtime_session_ref, { control_owner: "agent" });
    assert.equal("status" in stoppedPatchedSession, false);

    const confirmedSession = await postJson(`${running.url}/runtime/identity-environment-sessions`, {
      identity_environment_ref: "identity-env_read-operation-bypass",
      url: "https://www.zhipin.com/web/geek/job",
      control_owner: "user",
      reuse_existing: false
    });
    assert.equal(runtime.completeManualAuthentication(confirmedSession.runtime_session_ref).status, "unavailable");
    runtime.recordHandoff(confirmedSession.runtime_session_ref, { control_owner: "user", handoff_reason: "login_required" });
    assert.ok(runtime.completeManualAuthentication(confirmedSession.runtime_session_ref));
    runtime.recordHandoff(confirmedSession.runtime_session_ref, { control_owner: "agent", handoff_reason: "user_requested" });
    const released = await postJson(`${running.url}/runtime/sessions/${confirmedSession.runtime_session_ref}/release`, {});
    assert.equal(released.control_owner, "none");
    const releasedRead = await postReadOperation(`${running.url}/runtime/sessions/${confirmedSession.runtime_session_ref}/read-operations`, {
      site_id: "boss",
      operation_id: "boss_job_search",
      query: "AI tools",
      city_code: "101010100"
    });
    assert.equal(releasedRead.status, 409);
    assert.equal(releasedRead.body.failure_class, "session_user_controlled");
    assert.equal(successfulBossProbeCalls, 0);
  } finally {
    await running.close();
  }
});

test("returns bounded XHS public search cards paired with opaque detail refs", async () => {
  const observedLimits: Array<number | undefined> = [];
  const probe = trustLocalProviderReadProbe(async (input) => {
    observedLimits.push(input.limit);
    const sources = ["pinia_store_summary", "network_summary", "dom_snapshot_summary"].map((kind) => ({ kind, ref: opaqueRef("source") }));
    return {
      status: "completed",
      observed_at: "2026-07-28T00:00:00.000Z",
      observed_origin: "https://www.xiaohongshu.com",
      page: localReadPage(input.target_url),
      source_refs: sources,
      evidence_ref_kinds: [{ kind: "snapshot_ref", ref: opaqueRef("evidence") }],
      public_summary_source_ref: sources[1]!.ref,
      public_summary: {
        schema_version: "harbor-read-operation-public-summary/v0",
        operation_id: "xhs_search_notes",
        result_kind: "xiaohongshu_search_notes_surface",
        surface: "search_result",
        result_state: "operation_read_response_observed",
        response_status: 200,
        result_count: 2,
        source_signals: ["pinia_store", "xhs_search_read_network"]
      },
      detail_targets: [
        { canonical_url: "https://www.xiaohongshu.com/explore/0123456789abcdef01234567?xsec_token=private-navigation-token&xsec_source=pc_search" },
        { canonical_url: "https://www.xiaohongshu.com/explore/89abcdef0123456701234567?xsec_token=second-private-token&xsec_source=pc_search" }
      ],
      search_items: [{
        title: "公开搜索笔记",
        author_display_name: "公开作者",
        interaction_metrics: { likes: "128", comments: "12", collects: "34" }
      }, {
        title: "第二条公开笔记",
        author_display_name: "第二位公开作者",
        interaction_metrics: { likes: "64" }
      }],
      cookie_header: "session=private-cookie",
      cdp_endpoint: "ws://private-cdp-endpoint",
      raw_response_body: "raw-private-body"
    };
  });
  const runtime = new HarborRuntime(createBossReadLauncher(probe));
  const running = await startHarborRuntimeServer({ port: 0, runtime });
  try {
    await postIdentityEnvironment(`${running.url}/runtime/identity-environments`, {
      identity_environment_ref: "identity-env_xhs-public-cards",
      execution_identity_ref: "execution-identity_xhs-public-cards",
      profile_ref: "profile_xhs-public-cards",
      profile_storage_ref: "profile-storage_xhs-public-cards",
      site: { site_id: "xiaohongshu", origin: "https://www.xiaohongshu.com", display_name: "小红书" },
      login_state: "logged_in",
      storage_state: "present"
    });
    const session = await postJson(`${running.url}/runtime/identity-environment-sessions`, {
      identity_environment_ref: "identity-env_xhs-public-cards",
      url: "https://www.xiaohongshu.com/explore",
      control_owner: "user"
    });
    runtime.recordHandoff(session.runtime_session_ref, { control_owner: "user", handoff_reason: "login_required" });
    assert.ok(runtime.completeManualAuthentication(session.runtime_session_ref));
    runtime.recordHandoff(session.runtime_session_ref, { control_owner: "core_task", handoff_reason: "user_requested" });

    const search = await postReadOperation(`${running.url}/runtime/sessions/${session.runtime_session_ref}/read-operations`, {
      site_id: "xiaohongshu",
      operation_id: "xhs_search_notes",
      query: "AI",
      limit: 2
    });
    assert.equal(search.status, 201, JSON.stringify(search.body));
    assert.equal(search.body.public_summary.schema_version, "harbor-read-operation-public-summary/v1");
    assert.deepEqual(search.body.public_summary.items.map((item: { detail_ref: string }) => item.detail_ref), search.body.public_summary.detail_refs);
    assert.deepEqual(search.body.public_summary.items.map((item: { title: string }) => item.title), ["公开搜索笔记", "第二条公开笔记"]);
    assert.deepEqual(observedLimits, [2]);
    const publicJson = JSON.stringify(search.body).toLowerCase();
    for (const forbidden of ["xsec", "private-navigation-token", "profile-storage_xhs-public-cards", "private-cookie", "private-cdp-endpoint", "raw-private-body"]) {
      assert.equal(publicJson.includes(forbidden), false, forbidden);
    }

    for (const limit of [0, 1.5, 16]) {
      const invalid = await postReadOperation(`${running.url}/runtime/sessions/${session.runtime_session_ref}/read-operations`, {
        site_id: "xiaohongshu",
        operation_id: "xhs_search_notes",
        query: "AI",
        limit
      });
      assert.equal(invalid.status, 400, String(limit));
    }
    assert.deepEqual(observedLimits, [2]);
  } finally {
    await running.close();
  }
});

test("consumes a BOSS detail ref only once from the same real-search session", async () => {
  let failDetailProbe = false;
  let detailProbeRetryable = true;
  let detailProbeBarrier: Promise<void> | null = null;
  let markDetailProbeStarted: (() => void) | null = null;
  let providerCloseBarrier: Promise<void> | null = null;
  let markProviderCloseStarted: (() => void) | null = null;
  let providerCloseCalls = 0;
  const probe = trustLocalProviderReadProbe(async (input) => {
    if (input.operation_id === "boss_job_search") return {
      ...completedBossReadProbe(input),
      detail_targets: [{ canonical_url: "https://www.zhipin.com/job_detail/AbC_123.html" }]
    };
    if (input.operation_id === "boss_read_job_detail") {
      if (failDetailProbe) {
        markDetailProbeStarted?.();
        if (detailProbeBarrier) await detailProbeBarrier;
        return {
          status: "unavailable",
          failure_class: "page_not_ready",
          message: "Directed detail probe failure.",
          retryable: detailProbeRetryable
        };
      }
      const sources = ["wapi_job_detail_summary", "dom_snapshot_summary"].map((kind) => ({ kind, ref: opaqueRef("source") }));
      return {
        status: "completed",
        observed_at: "2026-07-12T00:00:00.000Z",
        observed_origin: "https://www.zhipin.com",
        page: localReadPage(input.target_url),
        source_refs: sources,
        evidence_ref_kinds: [{ kind: "snapshot_ref", ref: opaqueRef("evidence") }],
        public_summary_source_ref: sources[0]!.ref,
        public_summary: {
          schema_version: "harbor-read-operation-public-summary/v0",
          operation_id: "boss_read_job_detail",
          result_kind: "boss_job_detail_surface",
          surface: "job_detail",
          result_state: "operation_read_response_observed",
          response_status: 200,
          normalized: {
            kind: "boss_job_detail",
            canonical_url: "https://www.zhipin.com/job_detail/AbC_123.html",
            detail_ref: input.detail_ref!,
            title: "AI 工程师",
            summary: "公开职位摘要",
            job: { title: "AI 工程师", description: "公开职位描述", status: "available" },
            company: { name: "公开公司" },
            recruiter: { name: "公开招聘者", title: "招聘经理" },
            source_citation: {
              kind: "boss_job_detail_ref",
              detail_ref: input.detail_ref!,
              url: "https://www.zhipin.com/job_detail/AbC_123.html",
              field_sources: ["wapi_job_detail_summary", "dom_snapshot_summary"]
            },
            source_status: "located"
          },
          source_signals: ["boss_job_detail_document"]
        }
      };
    }
    throw new Error("Unexpected operation.");
  });
  const runtime = new HarborRuntime(createBossReadLauncher(probe, undefined, async () => {
    providerCloseCalls += 1;
    markProviderCloseStarted?.();
    if (providerCloseBarrier) await providerCloseBarrier;
  }));
  const running = await startHarborRuntimeServer({ port: 0, runtime });
  try {
    const identityEnvironment = await postIdentityEnvironment(`${running.url}/runtime/identity-environments`, {
      identity_environment_ref: "identity-env_boss-detail",
      execution_identity_ref: "execution-identity_boss-detail",
      profile_ref: "profile_boss-detail",
      profile_storage_ref: "profile-storage_boss-detail",
      site: { site_id: "boss", origin: "https://www.zhipin.com", display_name: "BOSS" },
      login_state: "logged_in",
      storage_state: "present"
    });
    const session = await postJson(`${running.url}/runtime/identity-environment-sessions`, {
      identity_environment_ref: "identity-env_boss-detail",
      url: "https://www.zhipin.com/web/geek/job",
      control_owner: "user"
    });
    runtime.recordHandoff(session.runtime_session_ref, { control_owner: "user", handoff_reason: "login_required" });
    assert.ok(runtime.completeManualAuthentication(session.runtime_session_ref));
    runtime.recordHandoff(session.runtime_session_ref, { control_owner: "core_task", handoff_reason: "user_requested" });

    const search = await postReadOperation(`${running.url}/runtime/sessions/${session.runtime_session_ref}/read-operations`, {
      site_id: "boss", operation_id: "boss_job_search", query: "AI", city_code: "101010100"
    });
    assert.equal(search.status, 201);
    const [detailRef] = search.body.public_summary.detail_refs;
    assert.match(detailRef, /^detail_ref_/);
    assert.equal(JSON.stringify(search.body).includes("AbC_123"), false);

    const released = await postJson(`${running.url}/runtime/sessions/${session.runtime_session_ref}/release`, {
      control_owner: "core_task"
    });
    assert.equal(released.lifecycle_state, "idle");
    const reused = await postJson(`${running.url}/runtime/identity-environment-sessions`, {
      identity_environment_ref: "identity-env_boss-detail",
      url: "https://www.zhipin.com/web/geek/job",
      control_owner: "core_task"
    });
    assert.equal(reused.runtime_session_ref, session.runtime_session_ref);

    const detail = await postReadOperation(`${running.url}/runtime/sessions/${session.runtime_session_ref}/read-operations`, {
      site_id: "boss", operation_id: "boss_read_job_detail", detail_ref: detailRef
    });
    assert.equal(detail.status, 201);
    assert.equal(detail.body.public_summary.result_kind, "boss_job_detail_surface");
    assert.equal(detail.body.public_summary.normalized.title, "AI 工程师");
    assert.equal(detail.body.public_summary.normalized.company.name, "公开公司");
    assert.equal(detail.body.public_summary.normalized.detail_ref, detailRef);
    assert.equal("securityId" in detail.body.public_summary.normalized, false);
    assert.equal("encryptJobId" in detail.body.public_summary.normalized, false);
    assert.equal(detail.body.public_summary.normalized.source_citation.detail_ref, detailRef);
    assert.equal(detail.body.lode_pin.merge_commit, "66d79b4e600565a00515b1c801e84291edc7b0c1");
    assert.deepEqual(detail.body.source_refs.map((entry: any) => entry.kind), ["wapi_job_detail_summary", "dom_snapshot_summary"]);
    assert.deepEqual(detail.body.evidence_ref_kinds.map((entry: any) => entry.kind), ["snapshot_ref"]);
    assert.equal(detail.body.public_summary.normalized.canonical_url, "https://www.zhipin.com/job_detail/AbC_123.html");
    assert.equal(JSON.stringify(detail.body).includes("securityId"), false);
    assert.equal(JSON.stringify(detail.body).includes("encryptJobId"), false);

    const repeated = await postReadOperation(`${running.url}/runtime/sessions/${session.runtime_session_ref}/read-operations`, {
      site_id: "boss", operation_id: "boss_read_job_detail", detail_ref: detailRef
    });
    assert.equal(repeated.status, 409);
    assert.equal(repeated.body.failure_class, "detail_ref_consumed");
    const directUrl = await postReadOperation(`${running.url}/runtime/sessions/${session.runtime_session_ref}/read-operations`, {
      site_id: "boss", operation_id: "boss_read_job_detail", detail_ref: detailRef, url: "https://www.zhipin.com/job_detail/AbC_123.html"
    });
    assert.equal(directUrl.status, 400);
    assert.equal(directUrl.body.failure_class, "invalid_request");

    const secondSearch = await postReadOperation(`${running.url}/runtime/sessions/${session.runtime_session_ref}/read-operations`, {
      site_id: "boss", operation_id: "boss_job_search", query: "AI", city_code: "101010100"
    });
    const [failureRef] = secondSearch.body.public_summary.detail_refs;
    failDetailProbe = true;
    const failed = await postReadOperation(`${running.url}/runtime/sessions/${session.runtime_session_ref}/read-operations`, {
      site_id: "boss", operation_id: "boss_read_job_detail", detail_ref: failureRef
    });
    assert.equal(failed.status, 409);
    assert.equal(failed.body.failure_class, "page_not_ready");
    assert.equal(JSON.stringify(failed.body).includes("AbC_123"), false);
    failDetailProbe = false;
    const replayAfterFailure = await postReadOperation(`${running.url}/runtime/sessions/${session.runtime_session_ref}/read-operations`, {
      site_id: "boss", operation_id: "boss_read_job_detail", detail_ref: failureRef
    });
    assert.equal(replayAfterFailure.status, 201);
    const replayAfterSuccess = await postReadOperation(`${running.url}/runtime/sessions/${session.runtime_session_ref}/read-operations`, {
      site_id: "boss", operation_id: "boss_read_job_detail", detail_ref: failureRef
    });
    assert.equal(replayAfterSuccess.status, 409);
    assert.equal(replayAfterSuccess.body.failure_class, "detail_ref_consumed");

    const generationSearch = await postReadOperation(`${running.url}/runtime/sessions/${session.runtime_session_ref}/read-operations`, {
      site_id: "boss", operation_id: "boss_job_search", query: "AI", city_code: "101010100"
    });
    const [generationRef] = generationSearch.body.public_summary.detail_refs;
    let releaseProbe!: () => void;
    detailProbeBarrier = new Promise<void>((resolve) => { releaseProbe = resolve; });
    let probeStarted!: () => void;
    const probeStartedPromise = new Promise<void>((resolve) => { probeStarted = resolve; });
    markDetailProbeStarted = probeStarted;
    failDetailProbe = true;
    const inFlightFailure = postReadOperation(`${running.url}/runtime/sessions/${session.runtime_session_ref}/read-operations`, {
      site_id: "boss", operation_id: "boss_read_job_detail", detail_ref: generationRef
    });
    await probeStartedPromise;
    await postJson(`${running.url}/runtime/sessions/${session.runtime_session_ref}/release`, { control_owner: "core_task" });
    const reacquired = await postJson(`${running.url}/runtime/identity-environment-sessions`, {
      identity_environment_ref: "identity-env_boss-detail",
      url: "https://www.zhipin.com/web/geek/job",
      control_owner: "core_task"
    });
    assert.equal(reacquired.runtime_session_ref, session.runtime_session_ref);
    releaseProbe();
    assert.equal((await inFlightFailure).body.failure_class, "page_not_ready");
    detailProbeBarrier = null;
    markDetailProbeStarted = null;
    failDetailProbe = false;
    const replayAfterControlChange = await postReadOperation(`${running.url}/runtime/sessions/${session.runtime_session_ref}/read-operations`, {
      site_id: "boss", operation_id: "boss_read_job_detail", detail_ref: generationRef
    });
    assert.equal(replayAfterControlChange.body.failure_class, "detail_ref_consumed");

    const nonRetryableSearch = await postReadOperation(`${running.url}/runtime/sessions/${session.runtime_session_ref}/read-operations`, {
      site_id: "boss", operation_id: "boss_job_search", query: "AI", city_code: "101010100"
    });
    const [nonRetryableRef] = nonRetryableSearch.body.public_summary.detail_refs;
    failDetailProbe = true;
    detailProbeRetryable = false;
    const nonRetryableFailure = await postReadOperation(`${running.url}/runtime/sessions/${session.runtime_session_ref}/read-operations`, {
      site_id: "boss", operation_id: "boss_read_job_detail", detail_ref: nonRetryableRef
    });
    assert.equal(nonRetryableFailure.body.failure_class, "page_not_ready");
    failDetailProbe = false;
    const replayAfterNonRetryableFailure = await postReadOperation(`${running.url}/runtime/sessions/${session.runtime_session_ref}/read-operations`, {
      site_id: "boss", operation_id: "boss_read_job_detail", detail_ref: nonRetryableRef
    });
    assert.equal(replayAfterNonRetryableFailure.body.failure_class, "detail_ref_consumed");

    const closeSearch = await postReadOperation(`${running.url}/runtime/sessions/${session.runtime_session_ref}/read-operations`, {
      site_id: "boss", operation_id: "boss_job_search", query: "AI", city_code: "101010100"
    });
    const [closeRef] = closeSearch.body.public_summary.detail_refs;
    let releaseCloseProbe!: () => void;
    detailProbeBarrier = new Promise<void>((resolve) => { releaseCloseProbe = resolve; });
    let closeProbeStarted!: () => void;
    const closeProbeStartedPromise = new Promise<void>((resolve) => { closeProbeStarted = resolve; });
    markDetailProbeStarted = closeProbeStarted;
    let releaseProviderClose!: () => void;
    providerCloseBarrier = new Promise<void>((resolve) => { releaseProviderClose = resolve; });
    let providerCloseStarted!: () => void;
    const providerCloseStartedPromise = new Promise<void>((resolve) => { providerCloseStarted = resolve; });
    markProviderCloseStarted = providerCloseStarted;
    failDetailProbe = true;
    detailProbeRetryable = true;
    const inFlightCloseFailure = postReadOperation(`${running.url}/runtime/sessions/${session.runtime_session_ref}/read-operations`, {
      site_id: "boss", operation_id: "boss_read_job_detail", detail_ref: closeRef
    });
    await closeProbeStartedPromise;
    const stopping = postJson(`${running.url}/runtime/sessions/${session.runtime_session_ref}/stop`, { control_owner: "core_task" });
    await providerCloseStartedPromise;
    assert.equal(runtime.getSession(session.runtime_session_ref)?.lifecycle_state, "disconnected");
    assert.ok("status" in runtime.releaseSession(session.runtime_session_ref, { control_owner: "core_task" }));
    const concurrentStopping = runtime.stopSession(session.runtime_session_ref, { control_owner: "core_task" });
    const reopenWhileClosing = await runtime.openManagedIdentityEnvironmentSession({
      identity_environment_ref: identityEnvironment.identity_environment_ref,
      url: "https://www.zhipin.com/web/geek/job",
      control_owner: "core_task",
      headless: false
    });
    releaseCloseProbe();
    releaseProviderClose();
    const inFlightCloseResult = await inFlightCloseFailure;
    await stopping;
    await concurrentStopping;
    assert.equal(providerCloseCalls, 1);
    assert.ok("status" in runtime.releaseSession(session.runtime_session_ref, { control_owner: "core_task" }));
    assert.ok("status" in reopenWhileClosing);
    assert.equal(reopenWhileClosing.status, "unavailable");
    assert.equal(inFlightCloseResult.body.failure_class, "page_not_ready");
    const detailTargets = (runtime as unknown as {
      detailReadTargets: {
        consume: (input: { detail_ref: string; runtime_session_ref: string; site_id: "boss"; operation_id: "boss_read_job_detail" }) => unknown;
      };
    }).detailReadTargets;
    assert.equal(detailTargets.consume({
      detail_ref: closeRef,
      runtime_session_ref: session.runtime_session_ref,
      site_id: "boss",
      operation_id: "boss_read_job_detail"
    }), "detail_ref_consumed");
  } finally {
    await running.close();
  }
});

test("returns JSON errors for bad routes and bad methods", async () => {
  const running = await startHarborRuntimeServer({ port: 0, runtime: new HarborRuntime(createFixtureLauncher("ready")) });
  try {
    const missing = await fetch(`${running.url}/missing`);
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).error, "not_found");

    const wrongMethod = await fetch(`${running.url}/runtime/sessions/session_missing/stop`);
    assert.equal(wrongMethod.status, 405);
    assert.equal((await wrongMethod.json()).error, "method_not_allowed");
  } finally {
    await running.close();
  }
});

let successfulBossProbeCalls = 0;

const successfulBossReadLauncher = createBossReadLauncher(async (probe) => {
  successfulBossProbeCalls += 1;
  if (probe.operation_id === "boss_job_search") return completedBossReadProbe(probe);
  return {
    status: "unavailable",
    failure_class: "provider_probe_unavailable",
    message: "The local test provider only exposes the BOSS read probe.",
    retryable: false
  };
});

function createBossReadLauncher(
  probeReadOperation: ReadOperationProbe,
  probeSiteResource?: SiteResourceProbe,
  close: () => Promise<void> = async () => {}
): LocalProviderLauncher {
  return async (input) => ({
  status: "ready",
  execution_surface: "local_provider",
  cdp_ref: "cdp_test-local-read-provider",
  viewer_entry: {
    availability: "available",
    access_mode: "interactive",
    transport: "local_window",
    input_capabilities: ["keyboard_mouse"]
  },
  page: localReadPage(input.url),
  facts: [],
  openUrl: async (url) => localReadPage(url),
  probeSiteResource,
  probeReadOperation,
  captureScreenshot: async () => ({
    screenshot_ref: "screenshot_test-local-read-provider",
    mime_type: "image/png",
    byte_length: 0,
    sha256: "0".repeat(64),
    captured_at: "2026-07-11T00:00:00.000Z",
    facts: []
  }),
  close
  });
}

function completedBossReadProbe(probe: Parameters<ReadOperationProbe>[0]): Awaited<ReturnType<ReadOperationProbe>> {
  const source = { kind: "network_summary", ref: opaqueRef("source") };
  return {
    status: "completed",
    observed_at: "2026-07-11T00:00:00.000Z",
    observed_origin: "https://www.zhipin.com",
    page: localReadPage(probe.target_url),
    source_refs: [source],
    evidence_ref_kinds: [
      { kind: "snapshot_ref", ref: opaqueRef("evidence") },
      { kind: "network_summary_ref", ref: opaqueRef("evidence") }
    ],
    public_summary_source_ref: source.ref,
    public_summary: {
      schema_version: "harbor-read-operation-public-summary/v0",
      operation_id: "boss_job_search",
      result_kind: "boss_job_search_surface",
      surface: "web_geek_jobs",
      result_state: "operation_read_response_observed",
      response_status: 200,
      query: probe.query,
      city_code: probe.city_code,
      business_code: 0,
      job_count: 2,
      source_signals: ["boss_wapi_zpgeek_read_network"]
    }
  };
}

function localReadPage(url: string) {
  return {
    current_url: url,
    title: "Local read provider",
    status: "ready" as const,
    facts: []
  };
}

async function getJson(url: string): Promise<any> {
  const response = await fetch(resolveIdentityAliasesInUrl(url));
  assert.equal(response.status, 200);
  return response.json();
}

async function postJson(url: string, body: unknown): Promise<any> {
  const createAlias = url.endsWith("/runtime/identity-environments") && body && typeof body === "object"
    ? (body as Record<string, unknown>).identity_environment_ref
    : null;
  const response = await fetch(resolveIdentityAliasesInUrl(url), {
    method: "POST",
    body: JSON.stringify(resolveIdentityAliasesInBody(body)),
    headers: { "content-type": "application/json", "idempotency-key": opaqueRef("request"), ...manualAuthHeaders() }
  });
  assert.equal(response.status === 200 || response.status === 201, true);
  const result = await response.json();
  if (typeof createAlias === "string" && typeof result.identity_environment_ref === "string") {
    identityAliases.set(createAlias, result.identity_environment_ref);
  }
  return result;
}

async function postIdentityEnvironment(url: string, body: Record<string, unknown>): Promise<any> {
  const stateKeys = ["login_state", "login_state_reason", "storage_state", "manual_authentication_state"] as const;
  const businessInput = Object.fromEntries(Object.entries(body).filter(([key]) => !stateKeys.includes(key as typeof stateKeys[number])));
  const stateUpdate = Object.fromEntries(stateKeys.flatMap((key) => Object.hasOwn(body, key) ? [[key, body[key]]] : []));
  const result = await postJson(url, businessInput);
  if (Object.keys(stateUpdate).length === 0) return result;

  const serverUrl = url.slice(0, -"/runtime/identity-environments".length);
  const owner = identityEnvironmentOwners.get(serverUrl);
  assert.ok(owner, "identity environment test state requires a Harbor owner");
  const record = owner.updateLocalIdentityEnvironment(
    result.identity_environment_ref,
    stateUpdate as Parameters<HarborRuntime["updateLocalIdentityEnvironment"]>[1]
  );
  assert.ok(record);
  return { ...result, record };
}

async function postReadOperation(url: string, body: unknown): Promise<{ status: number; body: any }> {
  const response = await fetch(resolveIdentityAliasesInUrl(url), {
    method: "POST",
    body: JSON.stringify(resolveIdentityAliasesInBody(body)),
    headers: { "content-type": "application/json", ...manualAuthHeaders() }
  });
  return { status: response.status, body: await response.json() };
}

async function patchJson(url: string, body: unknown): Promise<any> {
  const response = await fetch(resolveIdentityAliasesInUrl(url), {
    method: "PATCH",
    body: JSON.stringify(resolveIdentityAliasesInBody(body)),
    headers: { "content-type": "application/json", "idempotency-key": opaqueRef("request"), ...manualAuthHeaders() }
  });
  assert.equal(response.status, 200);
  return response.json();
}

async function deleteJson(url: string): Promise<any> {
  const response = await fetch(resolveIdentityAliasesInUrl(url), {
    method: "DELETE",
    headers: { "content-type": "application/json", "idempotency-key": opaqueRef("request"), ...manualAuthHeaders() },
    body: JSON.stringify({ operation: "remove" })
  });
  assert.equal(response.status, 200);
  return response.json();
}

function resolveIdentityAliasesInUrl(url: string): string {
  let resolved = url;
  const aliases = [...identityAliases].sort(([left], [right]) => right.length - left.length);
  for (const [alias, identityRef] of aliases) resolved = resolved.replaceAll(alias, identityRef);
  return resolved;
}

function resolveIdentityAliasesInBody(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(resolveIdentityAliasesInBody);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    key === "identity_environment_ref" && typeof item === "string"
      ? identityAliases.get(item) ?? item
      : resolveIdentityAliasesInBody(item)
  ]));
}

function resolvedIdentityRef(alias: string): string {
  return identityAliases.get(alias) ?? alias;
}

function supervisorToken(): string {
  return Buffer.alloc(32, 7).toString("base64url");
}

function differentSupervisorToken(): string {
  return Buffer.alloc(32, 8).toString("base64url");
}

function manualAuthHeaders(): Record<string, string> {
  return { authorization: `Bearer ${supervisorToken()}` };
}

function manualAuthenticationEnvironment(identity_environment_ref: string): Record<string, unknown> {
  return {
    identity_environment_ref,
    execution_identity_ref: `${identity_environment_ref}:execution`,
    profile_ref: `${identity_environment_ref}:profile`,
    site: { site_id: "boss", origin: "https://www.zhipin.com", display_name: "BOSS" },
    login_state: "manual_auth_required",
    storage_state: "present"
  };
}

function unsupportedViewerLauncher(execution_surface: "local_provider" | "fixture" | undefined): LocalProviderLauncher {
  const fixture = createFixtureLauncher("ready");
  return async (input) => {
    const launch = await fixture(input);
    if (launch.status !== "ready") return launch;
    const { execution_surface: _fixtureSurface, ...ready } = launch;
    return {
      ...ready,
      ...(execution_surface ? { execution_surface } : {}),
      viewer_entry: {
        availability: "unsupported",
        access_mode: "none",
        transport: "not_applicable",
        input_capabilities: [],
        unavailable_reason: "unsupported"
      }
    };
  };
}

async function postDuplicateAuthorization(url: string, token: string): Promise<{ status: number; body: unknown }> {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      hostname: target.hostname,
      port: Number(target.port),
      path: `${target.pathname}${target.search}`,
      method: "POST",
      headers: [
        "Host", target.host,
        "Authorization", `Bearer ${token}`,
        "Authorization", `Bearer ${token}`,
        "Content-Length", "0"
      ]
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.once("error", reject);
      response.once("end", () => {
        try {
          resolve({
            status: response.statusCode ?? 0,
            body: JSON.parse(Buffer.concat(chunks).toString("utf8"))
          });
        } catch (error) {
          reject(error);
        }
      });
    });
    request.once("error", reject);
    request.end();
  });
}
