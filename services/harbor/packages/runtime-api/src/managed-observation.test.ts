import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import test, { after } from "node:test";
import { HarborRuntime, createFixtureLauncher, type LocalProviderLauncher } from "./index.js";
import { LocalIdentityEnvironmentManager } from "./identity-environment-manager.js";
import { createMutationInput, identityInput, isolateProfileStorage, testProviderDetection } from "./identity-environment-mutation-test-helpers.js";
import { trustManagedPublicPageOperation, managedOperationCatalog, managedPageObservationExpression, normalizeManagedProviderObservation, trustManagedPageObserver } from "./managed-observation.js";
import { trustManagedInteractionOperation } from "./managed-interaction.js";
import { profileStoragePath } from "./profile-storage.js";
import { startHarborRuntimeServer } from "./server.js";
import type { LocalProviderPageController, LocalProviderPageState } from "./runtime-session-types.js";

after(isolateProfileStorage("managed-observation"));

function controlledLauncher(state: { id: string | null; opens: number; observe?: () => Promise<void> }): LocalProviderLauncher {
  const fixture = createFixtureLauncher("ready");
  return async input => {
    const ready = await fixture(input);
    if (ready.status !== "ready") throw new Error("fixture unavailable");
    return { ...ready, execution_surface: "local_provider", observePage: trustManagedPageObserver(async () => {
      await state.observe?.();
      return normalizeManagedProviderObservation({ current_url: "https://creator.xiaohongshu.com/publish/publish?secret=not-exported", title: "Creator", ready_state: "complete", stable_id: state.id });
    }), openUrl: async url => { state.opens++; return { current_url: url, title: "Creator", status: "ready", facts: [] }; } };
  };
}

test("same-instance observation discovers without binding, rejects unknown/conflicting/stale identities and preserves ownership", async () => {
  const state = { id: "account-a" as string | null, opens: 0 };
  const runtime = new HarborRuntime(controlledLauncher(state));
  for (const name of ["a", "b"]) runtime.createLocalIdentityEnvironment(identityInput(`identity:${name}`, `profile:${name}`));
  const a = await runtime.openManagedIdentityEnvironmentSession({ identity_environment_ref: "identity:a", url: "https://creator.xiaohongshu.com/publish/publish", control_owner: "core_task", holder_ref: "principal:one", operation_scope: "profile_management" });
  const b = await runtime.openManagedIdentityEnvironmentSession({ identity_environment_ref: "identity:b", url: "https://creator.xiaohongshu.com/publish/publish", control_owner: "core_task", holder_ref: "principal:one", operation_scope: "profile_management" });
  assert.ok(!("status" in a) && !("status" in b));
  if ("status" in a || "status" in b) throw new Error("session unavailable");
  try {
    const observe = () => runtime.observeManagedSession(a.runtime_session_ref, { holder_ref: "principal:one" });
    const first = await observe();
    assert.equal(first.status, "completed");
    if (first.status !== "completed") throw new Error("observation unavailable");
    assert.equal(first.runtime_session_ref, a.runtime_session_ref);
    assert.equal(first.profile_ref, "profile:a");
    assert.equal(first.account.account_ref, `account:sha256:${createHash("sha256").update(JSON.stringify({ site_id: "xiaohongshu", stable_id: "account-a" })).digest("hex")}`);
    assert.equal(JSON.stringify(first).includes("secret"), false);
    assert.equal(state.opens, 0);
    assert.deepEqual(runtime.getManagedLocalIdentityEnvironment("identity:a")?.account_bindings, []);
    const input = { observation_ref: first.observation_ref, account_system_ref: first.account.account_system_ref, account_ref: first.account.account_ref, idempotency_key: "bind-a", holder_ref: "principal:one" };
    const bound = await runtime.bindManagedAccount("identity:a", input);
    assert.ok("account_bindings" in bound && bound.account_bindings.length === 1);
    assert.deepEqual(await runtime.bindManagedAccount("identity:a", input), bound);
    const second = await runtime.observeManagedSession(b.runtime_session_ref, { holder_ref: "principal:one" });
    if (second.status !== "completed") throw new Error("observation unavailable");
    assert.equal((await runtime.bindManagedAccount("identity:b", { ...input, observation_ref: second.observation_ref, idempotency_key: "bind-b" }) as { failure_class?: string }).failure_class, "account_binding_conflict");
    state.id = "account-other";
    const changed = await observe();
    if (changed.status !== "completed") throw new Error("observation unavailable");
    assert.equal((await runtime.bindManagedAccount("identity:a", { ...input, observation_ref: changed.observation_ref, account_ref: changed.account.account_ref, idempotency_key: "bind-other" }) as { failure_class?: string }).failure_class, "account_binding_conflict");
    assert.equal((await runtime.bindManagedAccount("identity:a", { ...input, idempotency_key: "stale" }) as { failure_class?: string }).failure_class, "account_observation_changed");
    state.id = null;
    assert.equal((await observe()).status, "completed");
    assert.equal((await runtime.bindManagedAccount("identity:a", { ...input, idempotency_key: "unknown" }) as { failure_class?: string }).failure_class, "account_observation_changed");
    runtime.recordHandoff(a.runtime_session_ref, { control_owner: "user", handoff_reason: "login_required" });
    assert.equal((await observe() as { failure_class?: string }).failure_class, "control_lock_conflict");
    assert.equal((await runtime.bindManagedAccount("identity:a", input) as { failure_class?: string }).failure_class, "account_observation_required");
    runtime.releaseSession(a.runtime_session_ref, { control_owner: "user" });
    const releasedRecord = (runtime as unknown as { runtimeSessions: import("./runtime-session.js").RuntimeSessionStore }).runtimeSessions.getRecord(a.runtime_session_ref)!;
    const releasedGeneration = releasedRecord.control_generation;
    const releasedObservation = await observe();
    assert.ok(releasedObservation.status === "completed");
    assert.equal(releasedRecord.control_generation, releasedGeneration, "observation after handback must remain lease-free");
    assert.equal(releasedRecord.facts.control_owner, "none");
    assert.equal(releasedRecord.facts.control_lock.state, "released");
    runtime.lockSession(a.runtime_session_ref, { control_owner: "core_task", holder_ref: "principal:one" });
    const resumed = await observe();
    assert.ok(resumed.status === "completed" && resumed.control_generation > first.control_generation && resumed.runtime_session_ref === first.runtime_session_ref);
    assert.equal(state.opens, 0);
  } finally { await runtime.stopSession(a.runtime_session_ref); await runtime.stopSession(b.runtime_session_ref); }
});

test("shared persisted binding owner protects direct creation/import and exposes no implicit discovery binding", () => {
  const dir = mkdtempSync(join(tmpdir(), "managed-bindings-"));
  try {
    const options = { persistence_path: join(dir, "identities.json") };
    const manager = new LocalIdentityEnvironmentManager(options);
    const account_ref = "account:sha256:bound";
    manager.create({ ...identityInput("legacy:a", "legacy:profile-a"), site: { site_id: "xiaohongshu", origin: "https://www.xiaohongshu.com", account_ref } });
    const reloaded = new LocalIdentityEnvironmentManager(options);
    assert.throws(() => reloaded.create({ ...identityInput("legacy:b", "legacy:profile-b"), site: { site_id: "xiaohongshu", origin: "https://www.xiaohongshu.com", account_ref } }), /account_binding_conflict/);
    assert.throws(() => reloaded.importIdentityEnvironment({ ...identityInput("legacy:c", "legacy:profile-c"), site: { site_id: "xiaohongshu", origin: "https://www.xiaohongshu.com", account_ref } }), /account_binding_conflict/);
    assert.equal(reloaded.list().length, 1);
    assert.equal(reloaded.mutate({ operation: "copy_full", identity_environment_ref: "legacy:a", idempotency_key: "full-duplicate" }).status, "rejected");
    mkdirSync(profileStoragePath("legacy:profile-a:storage"), { recursive: true });
    const copied = reloaded.mutate({ operation: "copy_environment", identity_environment_ref: "legacy:a", idempotency_key: "environment-copy" });
    assert.equal(copied.status, "completed");
    assert.equal(copied.record?.site.account_ref, null);
    assert.deepEqual(copied.record?.account_bindings, []);
    assert.equal(copied.record?.status.login_state, "logged_out");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("management scope opens persisted unauthenticated profiles without promoting site authentication; receipt/session reads require supervisor", async () => {
  const dir = mkdtempSync(join(tmpdir(), "managed-scope-"));
  const state = { id: null, opens: 0 };
  const options = { persistence_path: join(dir, "identities.json"), provider_detection: testProviderDetection };
  const seed = new HarborRuntime(controlledLauncher(state), options);
  const creation = seed.mutateLocalIdentityEnvironment({ operation: "create", idempotency_key: "receipt:created", identity_environment: createMutationInput() });
  assert.equal(creation.status, "completed");
  const identity = creation.record!.identity_environment_ref;
  const runtime = new HarborRuntime(controlledLauncher(state), options);
  const input = { identity_environment_ref: identity, url: "https://example.com/", control_owner: "core_task" as const, holder_ref: "principal:one" };
  assert.equal((await runtime.openManagedIdentityEnvironmentSession(input) as { failure_class?: string }).failure_class, "identity_environment_unavailable");
  const session = await runtime.openManagedIdentityEnvironmentSession({ ...input, operation_scope: "profile_management" });
  assert.ok(!("status" in session));
  if ("status" in session) throw new Error("management session unavailable");
  const token = Buffer.alloc(32, 13).toString("base64url");
  const server = await startHarborRuntimeServer({ port: 0, runtime, manual_authentication_supervisor_token: token });
  try {
    assert.notEqual(runtime.getManagedLocalIdentityEnvironment(identity)?.status.authentication_provenance, "user_confirmed_managed_session");
    const read = await runtime.executeLegacyReadOperation(session.runtime_session_ref, { site_id: "xiaohongshu", operation_id: "xhs_search_notes", query: "public", limit: 1 });
    assert.equal(read.status, "unavailable");
    if (read.status === "unavailable") assert.equal(read.failure_class, "not_logged_in");
    for (const path of [`/runtime/identity-environments/${encodeURIComponent(identity)}/session`, "/runtime/identity-environment-mutations/receipt%3Acreated"]) {
      assert.equal((await fetch(`${server.url}${path}`)).status, 403);
      assert.equal((await fetch(`${server.url}${path}`, { headers: { authorization: `Bearer ${token}` } })).status, 200);
    }
    for (const action of ["navigate", "read"]) {
      assert.equal((await fetch(`${server.url}/runtime/sessions/${encodeURIComponent(session.runtime_session_ref)}/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status, 403);
    }
    const wrongHandoff = await fetch(`${server.url}/runtime/sessions/${encodeURIComponent(session.runtime_session_ref)}/handoff`, {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ control_owner: "user", expected_control_owner: "core_task", handoff_reason: "user_requested", holder_ref: "principal:other" })
    });
    assert.equal(wrongHandoff.status, 409);
    assert.equal((await wrongHandoff.json() as { failure_class: string }).failure_class, "session_locked");
    const receipt = await fetch(`${server.url}/runtime/identity-environment-mutations/receipt%3Acreated`, { headers: { authorization: `Bearer ${token}` } }).then(response => response.json());
    assert.deepEqual(receipt, creation);
    assert.deepEqual(await fetch(`${server.url}/runtime/managed-operation-catalog`).then(response => response.json()), managedOperationCatalog);
  } finally { await server.close(); await runtime.stopSession(session.runtime_session_ref); rmSync(dir, { recursive: true, force: true }); }
});

test("managed operation catalog preserves compatibility categories", () => {
  const categories = new Map(managedOperationCatalog.operations.map(operation => [operation.operation_id, operation.category]));
  for (const [category, operations] of Object.entries({
    commit: ["profile.create", "account.bind"],
    read: ["recovery.inspect", "recovery.status", "page.list"],
    prepare: ["recovery.request", "page.open", "page.activate", "page.close", "page.navigate", "page.reload", "page.back", "page.forward"]
  })) for (const operation of operations) assert.equal(categories.get(operation), category, operation);
});


test("in-flight observation cannot publish after stop or permit concurrent takeover", async () => {
  let unblock!: () => void, started!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const waiting = new Promise<void>(resolve => { unblock = resolve; });
  const state = { id: "test-account", opens: 0, observe: async () => { started(); await waiting; } };
  const runtime = new HarborRuntime(controlledLauncher(state));
  runtime.createLocalIdentityEnvironment(identityInput("identity:inflight", "profile:inflight"));
  const session = await runtime.openManagedIdentityEnvironmentSession({ identity_environment_ref: "identity:inflight", url: "https://example.com/", control_owner: "core_task", holder_ref: "principal:one", operation_scope: "profile_management" });
  if ("status" in session) throw new Error("session unavailable");
  const observing = runtime.observeManagedSession(session.runtime_session_ref, { holder_ref: "principal:one" });
  await entered;
  assert.equal((await runtime.observeManagedSession(session.runtime_session_ref, { holder_ref: "principal:one" }) as { failure_class?: string }).failure_class, "session_not_ready");
  assert.equal((runtime.recordHandoff(session.runtime_session_ref, { control_owner: "user" }) as { failure_class?: string }).failure_class, "session_locked");
  await runtime.stopSession(session.runtime_session_ref);
  unblock();
  assert.equal((await observing as { failure_class?: string }).failure_class, "control_changed");
});


test("the shared fixed expression requires visible creator labels to match the authenticated stable ID", () => {
  const element = { getBoundingClientRect: () => ({ width: 10, height: 10 }) };
  let label = "Owner", username = "Owner", origin = "https://creator.xiaohongshu.com";
  const root = { ...element, querySelectorAll: () => [{ ...element, get innerText() { return label; } }] };
  const app = { ...element, querySelectorAll: () => [root], __vue_app__: { config: { globalProperties: { $store: { state: { Auth: { userInfo: { userId: "stable-owner", get userName() { return username; } } } } } } } } };
  const evaluate = () => runInNewContext(managedPageObservationExpression, {
    document: { querySelector: () => app, title: "Creator", readyState: "complete" },
    location: { get origin() { return origin; }, pathname: "/publish/publish" }, getComputedStyle: () => ({ visibility: "visible", display: "block" })
  });
  assert.equal(normalizeManagedProviderObservation(evaluate()).account.status, "verified");
  username = "Other";
  assert.equal(normalizeManagedProviderObservation(evaluate()).account.status, "unknown");
  username = label;
  origin = "https://example.com";
  assert.equal(normalizeManagedProviderObservation(evaluate()).account.status, "unknown");
});


test("stop refuses a different principal holding the same Core control-owner kind", async () => {
  const runtime = new HarborRuntime(createFixtureLauncher("ready"));
  const session = await runtime.createSession({ control_owner: "core_task", holder_ref: "principal:original" });
  const denied = await runtime.stopSession(session.runtime_session_ref, { control_owner: "core_task", holder_ref: "principal:other" });
  assert.ok("status" in denied && denied.failure_class === "session_locked");
  assert.notEqual(runtime.getSession(session.runtime_session_ref)?.lifecycle_state, "closed");
  const stopped = await runtime.stopSession(session.runtime_session_ref, { control_owner: "core_task", holder_ref: "principal:original" });
  assert.ok(!("status" in stopped) && stopped.lifecycle_state === "closed");
});


test("bounded public operations keep the exact instance, refuse identity origins and changed leases, and report redirects without reading", async () => {
  const calls: { ref: string; url?: string }[] = [];
  let guardClears = 0;
  const launcher: LocalProviderLauncher = async input => {
    assert.equal(input.operation_scope, "profile_management");
    const ready = await createFixtureLauncher("ready")(input);
    if (ready.status !== "ready") throw new Error("fixture unavailable");
    let current = input.url;
    return { ...ready, execution_surface: "local_provider", clearPublicPageGuard: async () => { guardClears++; }, publicPage: trustManagedPublicPageOperation(async operation => {
      calls.push({ ref: input.profile_ref, url: operation.url });
      current = operation.url ?? current;
      if (current.endsWith("/redirect")) {
        current = "https://denied.example/";
        return { status: "unavailable", failure_class: "managed_public_navigation_redirected", retryable: false,
          page: { current_url: current, title: "Redirected", status: "ready", facts: [] } };
      }
      return { status: "completed", page: { current_url: current, title: "Public", status: "ready", facts: [] },
        ...(operation.url ? {} : { text: "A verifiable public paragraph.", truncated: false }) };
    }) };
  };
  const runtime = new HarborRuntime(launcher);
  for (const suffix of ["a", "b"]) runtime.createLocalIdentityEnvironment({ ...identityInput(`public:${suffix}`, `public-profile:${suffix}`), site: { site_id: "public", origin: "https://example.com", display_name: "Public" } });
  const a = await runtime.openManagedIdentityEnvironmentSession({ identity_environment_ref: "public:a", url: "https://example.com/", control_owner: "core_task", holder_ref: "principal:one", operation_scope: "profile_management" });
  const b = await runtime.openManagedIdentityEnvironmentSession({ identity_environment_ref: "public:b", url: "https://example.com/", control_owner: "core_task", holder_ref: "principal:one", operation_scope: "profile_management" });
  if ("status" in a || "status" in b) throw new Error("session unavailable");
  const input = { holder_ref: "principal:one", expected_origin: "https://example.com" };
  try {
    for (const url of ["https://example.com/one", "https://example.com/two"]) {
      const result = await runtime.operateManagedPublicPage(a.runtime_session_ref, { ...input, url }, true);
      assert.ok(result.status === "completed" && result.session.runtime_session_ref === a.runtime_session_ref);
    }
    const read = await runtime.operateManagedPublicPage(a.runtime_session_ref, input, false);
    assert.ok(read.status === "completed" && read.text === "A verifiable public paragraph.");
    assert.equal(runtime.getSession(b.runtime_session_ref)?.current_page.current_url, "https://example.com/");
    assert.equal((await runtime.clearManagedPublicPageGuard(a.runtime_session_ref)).status, "unavailable");
    assert.equal(guardClears, 0);
    const beforeDenied = calls.length;
    for (const invalid of [{ ...input, expected_origin: "https://creator.xiaohongshu.com" }, { ...input, expected_origin: "https://www.zhipin.com" }, { ...input, expression: "document.cookie" }]) {
      assert.equal((await runtime.operateManagedPublicPage(a.runtime_session_ref, invalid, false)).status, "unavailable");
    }
    assert.equal((await runtime.operateManagedPublicPage(a.runtime_session_ref, { ...input, url: "https://denied.example/" }, true)).status, "unavailable");
    assert.equal((await runtime.operateManagedPublicPage("stale:session", input, false)).status, "unavailable");
    assert.equal(calls.length, beforeDenied);
    runtime.recordHandoff(a.runtime_session_ref, { control_owner: "user", handoff_reason: "user_requested" });
    assert.equal((await runtime.clearManagedPublicPageGuard(a.runtime_session_ref)).status, "completed");
    assert.equal(guardClears, 1);
    assert.equal((await runtime.operateManagedPublicPage(a.runtime_session_ref, input, false)).status, "unavailable");
    runtime.releaseSession(a.runtime_session_ref, { control_owner: "user" });
    const releasedRecord = (runtime as unknown as { runtimeSessions: import("./runtime-session.js").RuntimeSessionStore }).runtimeSessions.getRecord(a.runtime_session_ref)!;
    const releasedGeneration = releasedRecord.control_generation;
    const releasedRead = await runtime.operateManagedPublicPage(a.runtime_session_ref, input, false);
    assert.ok(releasedRead.status === "completed" && releasedRead.text === "A verifiable public paragraph.");
    assert.equal(releasedRecord.control_generation, releasedGeneration, "public read after handback must remain lease-free");
    assert.equal(releasedRecord.facts.control_owner, "none");
    assert.equal(releasedRecord.facts.control_lock.state, "released");
    runtime.lockSession(a.runtime_session_ref, { control_owner: "core_task", holder_ref: "principal:one" });
    const resumed = await runtime.operateManagedPublicPage(a.runtime_session_ref, input, false);
    assert.ok(resumed.status === "completed" && resumed.session.runtime_session_ref === a.runtime_session_ref);
    const redirected = await runtime.operateManagedPublicPage(a.runtime_session_ref, { ...input, url: "https://example.com/redirect" }, true);
    assert.ok(redirected.status === "unavailable" && redirected.failure_class === "managed_public_navigation_redirected");
    assert.equal(runtime.getSession(a.runtime_session_ref)?.current_page.current_url, "https://denied.example/");
    assert.equal("text" in redirected, false);
  } finally { await runtime.stopSession(a.runtime_session_ref); await runtime.stopSession(b.runtime_session_ref); }
});

test("legacy instance observation and public operations require an explicit Page when same-origin Pages are ambiguous", async () => {
  const origin = "https://example.com";
  const calls: { kind: "public" | "observe"; provider_page_ref?: string }[] = [];
  const pages: LocalProviderPageState[] = [
    { provider_page_ref: "provider:a", current_url: `${origin}/a`, title: "A", status: "ready", facts: [], active: true, document_generation: 1 },
    { provider_page_ref: "provider:b", current_url: `${origin}/b`, title: "B", status: "ready", facts: [], active: false, document_generation: 1 }
  ];
  const pageController: LocalProviderPageController = {
    listPages: async () => structuredClone(pages),
    openPage: async () => structuredClone(pages[1]!),
    activatePage: async provider_page_ref => {
      for (const page of pages) page.active = page.provider_page_ref === provider_page_ref;
      return structuredClone(pages.find(page => page.provider_page_ref === provider_page_ref)!);
    },
    closePage: async provider_page_ref => {
      const index = pages.findIndex(page => page.provider_page_ref === provider_page_ref);
      if (index >= 0) pages.splice(index, 1);
      if (!pages.some(page => page.active) && pages[0]) pages[0].active = true;
      return structuredClone(pages);
    },
    navigatePage: async provider_page_ref => structuredClone(pages.find(page => page.provider_page_ref === provider_page_ref)!)
  };
  const launcher: LocalProviderLauncher = async input => {
    const ready = await createFixtureLauncher("ready")(input);
    if (ready.status !== "ready") throw new Error("fixture unavailable");
    return {
      ...ready,
      execution_surface: "local_provider",
      page: pages[0]!,
      pages,
      pageController,
      publicPage: trustManagedPublicPageOperation(async operation => {
        calls.push({ kind: "public", provider_page_ref: operation.provider_page_ref });
        const selected = pages.find(page => page.provider_page_ref === operation.provider_page_ref);
        if (!selected) return { status: "unavailable", failure_class: "managed_public_page_unavailable", retryable: true };
        return { status: "completed", page: { current_url: selected.current_url, title: selected.title, status: selected.status, facts: [], document_generation: selected.document_generation } };
      }),
      observePage: trustManagedPageObserver(async operation => {
        calls.push({ kind: "observe", provider_page_ref: operation?.provider_page_ref });
        const selected = pages.find(page => page.provider_page_ref === operation?.provider_page_ref);
        if (!selected) throw new Error("provider page missing");
        return normalizeManagedProviderObservation({ current_url: selected.current_url, title: selected.title, ready_state: "complete", document_generation: selected.document_generation });
      })
    };
  };
  const runtime = new HarborRuntime(launcher);
  runtime.createLocalIdentityEnvironment({ ...identityInput("identity:multipage", "profile:multipage"), site: { site_id: "public", origin, display_name: "Public" } });
  const session = await runtime.openManagedIdentityEnvironmentSession({ identity_environment_ref: "identity:multipage", url: `${origin}/a`, control_owner: "core_task", holder_ref: "principal:one", operation_scope: "profile_management" });
  if ("status" in session) throw new Error("session unavailable");
  try {
    const listed = await runtime.operateManagedPage(session.runtime_session_ref, { operation: "page.list", authorized_origins: [origin] });
    assert.equal("status" in listed && listed.status, "completed");
    if (!("pages" in listed)) throw new Error("page list unavailable");
    const selected = listed.pages.find(page => page.current_url === `${origin}/b`)!;
    assert.ok(selected);

    const publicInput = { holder_ref: "principal:one", expected_origin: origin };
    const ambiguousRead = await runtime.operateManagedPublicPage(session.runtime_session_ref, publicInput, false);
    assert.equal(ambiguousRead.status, "unavailable");
    if (ambiguousRead.status === "unavailable") assert.equal(ambiguousRead.failure_class, "page_selection_required");
    const observeCallsBeforeAmbiguous = calls.length;
    const ambiguousObserve = await runtime.observeManagedSession(session.runtime_session_ref, { holder_ref: "principal:one", expected_origin: origin });
    assert.equal(ambiguousObserve.status, "unavailable");
    if (ambiguousObserve.status === "unavailable") assert.equal(ambiguousObserve.failure_class, "page_selection_required");
    assert.equal(calls.length, observeCallsBeforeAmbiguous, "ambiguous legacy calls must not reach the Provider");

    const explicit = { ...publicInput, page_id: selected.page_id, page_ref: selected.page_ref, document_generation: selected.document_generation };
    const read = await runtime.operateManagedPublicPage(session.runtime_session_ref, explicit, false);
    assert.equal(read.status, "completed");
    assert.deepEqual(calls.at(-1), { kind: "public", provider_page_ref: "provider:b" });
    assert.equal(read.status === "completed" ? read.session.current_page.page_ref : undefined, selected.page_ref);

    const observed = await runtime.observeManagedSession(session.runtime_session_ref, explicit);
    assert.equal(observed.status, "completed");
    assert.deepEqual(calls.at(-1), { kind: "observe", provider_page_ref: "provider:b" });
    assert.equal(observed.status === "completed" ? observed.page.page_ref : undefined, selected.page_ref);
    const stale = await runtime.operateManagedPublicPage(session.runtime_session_ref, { ...publicInput, page_ref: "page:stale" }, false);
    assert.equal(stale.status, "unavailable");
    if (stale.status === "unavailable") assert.equal(stale.failure_class, "stale_page");
  } finally { await runtime.stopSession(session.runtime_session_ref); }
});

test("legacy observation, public, and interaction paths fence a handoff that occurs during Page refresh", async () => {
  const origin = "https://example.com";
  for (const kind of ["public", "observe", "interaction"] as const) {
    let providerCalls = 0;
    let releaseRefresh!: () => void;
    let markRefreshStarted!: () => void;
    const refreshStarted = new Promise<void>(resolve => { markRefreshStarted = resolve; });
    const refreshReleased = new Promise<void>(resolve => { releaseRefresh = resolve; });
    let blockRefresh = true;
    const page: LocalProviderPageState = { provider_page_ref: "provider:race", current_url: `${origin}/race`, title: "Race", status: "ready", facts: [], active: true, document_generation: 1 };
    const pageController: LocalProviderPageController = {
      listPages: async () => {
        if (blockRefresh) {
          blockRefresh = false;
          markRefreshStarted();
          await refreshReleased;
        }
        return [structuredClone(page)];
      },
      openPage: async () => structuredClone(page),
      activatePage: async () => structuredClone(page),
      closePage: async () => [],
      navigatePage: async () => structuredClone(page)
    };
    const launcher: LocalProviderLauncher = async input => {
      const ready = await createFixtureLauncher("ready")(input);
      if (ready.status !== "ready") throw new Error("fixture unavailable");
      return {
        ...ready,
        execution_surface: "local_provider",
        page,
        pages: [page],
        pageController,
        publicPage: trustManagedPublicPageOperation(async operation => {
          providerCalls++;
          return { status: "completed", page: { current_url: operation.url ?? page.current_url, title: page.title, status: page.status, facts: [] } };
        }),
        observePage: trustManagedPageObserver(async () => {
          providerCalls++;
          return normalizeManagedProviderObservation({ current_url: page.current_url, title: page.title, ready_state: "complete" });
        }),
        interaction: trustManagedInteractionOperation(async () => {
          providerCalls++;
          return { status: "completed", dispatch_state: "dispatched", page: { current_url: page.current_url, title: page.title, status: page.status, facts: [] }, snapshot: { page_ref: "provider:snapshot", observation_ref: "observation:race", controls: [], text: "", truncated: false } };
        })
      };
    };
    const runtime = new HarborRuntime(launcher);
    runtime.createLocalIdentityEnvironment({ ...identityInput(`identity:race-${kind}`, `profile:race-${kind}`), site: { site_id: "public", origin, display_name: "Public" } });
    const session = await runtime.openManagedIdentityEnvironmentSession({ identity_environment_ref: `identity:race-${kind}`, url: `${origin}/race`, control_owner: "core_task", holder_ref: "principal:one", operation_scope: "profile_management" });
    if ("status" in session) throw new Error("session unavailable");
    const input = { holder_ref: "principal:one", expected_origin: origin };
    const pending = kind === "public"
      ? runtime.operateManagedPublicPage(session.runtime_session_ref, input, false)
      : kind === "observe"
        ? runtime.observeManagedSession(session.runtime_session_ref, input)
        : runtime.operateManagedInteraction(session.runtime_session_ref, { holder_ref: "principal:one", operation_ref: "operation:race", action: "snapshot", expected_origin: origin, controlled_origin: origin, authorized_origins: [origin] });
    await refreshStarted;
    const handoff = runtime.recordHandoff(session.runtime_session_ref, { control_owner: "user", handoff_reason: "user_requested" });
    assert.equal("status" in handoff, false);
    assert.equal("status" in runtime.releaseSession(session.runtime_session_ref, { control_owner: "user" }), false);
    assert.equal("status" in runtime.lockSession(session.runtime_session_ref, { control_owner: "core_task", holder_ref: "principal:one" }), false);
    releaseRefresh();
    const result = await pending;
    assert.equal(result.status, "unavailable");
    if (result.status === "unavailable") assert.equal(result.failure_class, kind === "interaction" ? "managed_interaction_control_changed" : "control_changed");
    assert.equal(providerCalls, 0, `${kind} Provider operation must not run after a takeover-and-return during refresh`);
    await runtime.stopSession(session.runtime_session_ref);
  }
});
