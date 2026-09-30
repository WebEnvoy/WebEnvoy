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
import { trustManagedPublicPageOperation, managedOperationCatalog, managedPageObservationExpression, normalizeManagedProviderObservation, trustManagedPageObserver, hasManagedBindingConflict, profileIdentityOwnership, type ManagedObservation } from "./managed-observation.js";
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

function managedPageLauncher(state: { id: string | null }): LocalProviderLauncher {
  const fixture = createFixtureLauncher("ready");
  return async input => {
    const ready = await fixture(input);
    if (ready.status !== "ready") throw new Error("fixture unavailable");
    let pageNumber = 0;
    const pages: LocalProviderPageState[] = [{ provider_page_ref: `provider:${input.profile_ref}`, current_url: input.url, title: "Creator", status: "ready", facts: [], active: true, document_generation: 1 }];
    const controller: LocalProviderPageController = {
      listPages: async () => structuredClone(pages),
      openPage: async url => {
        const page: LocalProviderPageState = { provider_page_ref: `provider:${input.profile_ref}:${++pageNumber}`, current_url: url ?? "https://creator.xiaohongshu.com/publish/publish", title: "Creator", status: "ready", facts: [], active: false, document_generation: 1 };
        pages.push(page);
        return structuredClone(page);
      },
      activatePage: async provider_page_ref => {
        for (const page of pages) page.active = page.provider_page_ref === provider_page_ref;
        return structuredClone(pages.find(page => page.provider_page_ref === provider_page_ref)!);
      },
      closePage: async provider_page_ref => {
        const index = pages.findIndex(page => page.provider_page_ref === provider_page_ref);
        if (index >= 0) pages.splice(index, 1);
        return structuredClone(pages);
      },
      navigatePage: async (provider_page_ref, action, url) => {
        const page = pages.find(item => item.provider_page_ref === provider_page_ref)!;
        if (action === "navigate" && url) page.current_url = url;
        page.document_generation = (page.document_generation ?? 1) + 1;
        return structuredClone(page);
      }
    };
    return {
      ...ready,
      execution_surface: "local_provider",
      page: pages[0]!,
      pages,
      pageController: controller,
      observePage: trustManagedPageObserver(async operation => {
        const page = pages.find(item => item.provider_page_ref === operation?.provider_page_ref);
        if (!page) throw new Error("provider page missing");
        return { ...normalizeManagedProviderObservation({ current_url: page.current_url, title: page.title, ready_state: "complete", stable_id: state.id, document_generation: page.document_generation }), provider_page_ref: page.provider_page_ref };
      })
    };
  };
}

test("same-instance observation discovers without binding, rejects unknown/conflicting/stale identities and preserves ownership", async () => {
  const state = { id: "account-a" as string | null, opens: 0 };
  const runtime = new HarborRuntime(managedPageLauncher(state));
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
    const discovered = runtime.listManagedIdentityEnvironmentProfiles().find(profile => profile.identity_environment_ref === "identity:a")!;
    assert.equal(discovered.identity_ownership.current.status, "discovered");
    assert.equal(discovered.identity_ownership.ownership.status, "unknown");
    assert.deepEqual(discovered.identity_ownership.history.bindings, []);
    const bindingInput = (observation: ManagedObservation, idempotency_key: string) => ({ observation_ref: observation.observation_ref,
      runtime_session_ref: observation.runtime_session_ref, page_id: observation.page.page_id!, page_ref: observation.page.page_ref!,
      document_generation: observation.page.document_generation!, account_system_ref: observation.account.account_system_ref!,
      account_ref: observation.account.account_ref!, idempotency_key, holder_ref: "principal:one" });
    const input = bindingInput(first, "bind-a");
    const bound = await runtime.bindManagedAccount("identity:a", input);
    assert.ok("account_bindings" in bound && bound.account_bindings.length === 1 && "observation" in bound);
    assert.deepEqual(await runtime.bindManagedAccount("identity:a", input), bound);
    assert.deepEqual(runtime.getManagedAccountBindingOperation("bind-a"), { status: "completed", result: bound });
    assert.equal((await runtime.bindManagedAccount("identity:a", { ...input, account_ref: `account:sha256:${"f".repeat(64)}` }) as { failure_class?: string }).failure_class, "idempotency_conflict");
    const owned = runtime.listManagedIdentityEnvironmentProfiles().find(profile => profile.identity_environment_ref === "identity:a")!;
    assert.equal(owned.identity_ownership.current.status, "verified");
    assert.equal(owned.identity_ownership.history.bindings[0]?.verification, "verified_at_binding");
    assert.equal(owned.identity_ownership.history.bindings[0]?.ownership_status, "unique");
    assert.equal(owned.identity_ownership.ownership.status, "unique");
    const second = await runtime.observeManagedSession(b.runtime_session_ref, { holder_ref: "principal:one" });
    if (second.status !== "completed") throw new Error("observation unavailable");
    const conflicted = runtime.listManagedIdentityEnvironmentProfiles().find(profile => profile.identity_environment_ref === "identity:b")!;
    assert.equal(conflicted.identity_ownership.current.status, "conflict");
    assert.equal(conflicted.identity_ownership.ownership.status, "unknown");
    assert.equal(JSON.stringify(conflicted.identity_ownership).includes("identity:a"), false, "account conflict must not expose the other Profile reference");
    assert.equal((await runtime.bindManagedAccount("identity:b", bindingInput(second, "bind-b")) as { failure_class?: string }).failure_class, "account_binding_conflict");
    state.id = "account-other";
    const changed = await observe();
    if (changed.status !== "completed") throw new Error("observation unavailable");
    const changedProjection = runtime.listManagedIdentityEnvironmentProfiles().find(profile => profile.identity_environment_ref === "identity:a")!;
    assert.equal(changedProjection.identity_ownership.current.status, "conflict");
    assert.equal(changedProjection.identity_ownership.history.bindings[0]?.account_ref, first.account.account_ref);
    assert.equal(changedProjection.identity_ownership.ownership.status, "unique", "current login identity does not replace persistent owner binding");
    assert.equal((await runtime.bindManagedAccount("identity:a", bindingInput(changed, "bind-other")) as { failure_class?: string }).failure_class, "account_binding_conflict");
    assert.equal((await runtime.bindManagedAccount("identity:a", { ...input, idempotency_key: "stale" }) as { failure_class?: string }).failure_class, "account_observation_changed");
    state.id = null;
    assert.equal((await observe()).status, "completed");
    assert.equal((await runtime.bindManagedAccount("identity:a", { ...input, idempotency_key: "unknown" }) as { failure_class?: string }).failure_class, "account_observation_changed");
    runtime.recordHandoff(a.runtime_session_ref, { control_owner: "user", handoff_reason: "login_required" });
    assert.equal((await observe() as { failure_class?: string }).failure_class, "control_lock_conflict");
    assert.deepEqual(await runtime.bindManagedAccount("identity:a", input), bound, "the exact persisted binding receipt remains queryable after handoff");
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
  const stopped = runtime.listManagedIdentityEnvironmentProfiles().find(profile => profile.identity_environment_ref === "identity:a")!;
  assert.equal(stopped.identity_ownership.current.status, "unknown");
  assert.equal(stopped.identity_ownership.current.observed_at, null);
  assert.equal(stopped.identity_ownership.history.bindings[0]?.verification, "verified_at_binding");
  assert.equal(stopped.identity_ownership.ownership.status, "unique");
});

test("tuple ownership remains precise when another Account binding conflicts", () => {
  const at = "2026-09-30T00:00:00.000Z";
  const accountSystemA = "account-system:a", accountSystemB = "account-system:b";
  const accountA = `account:sha256:${"a".repeat(64)}`, accountB = `account:sha256:${"b".repeat(64)}`;
  const stored = (identity_environment_ref: string, profile_ref: string, account_bindings: { account_system_ref: string; account_ref: string; observation_ref: string; bound_at: string }[]) => ({
    schema_version: "harbor-local-identity-environment-store/v0" as const,
    operation: "created" as const,
    created_at: at,
    updated_at: at,
    identity_environment: { identity_environment_ref, profile_ref, site_binding: { site_id: "example", account_ref: null } },
    account_bindings,
    lifecycle_state: "active" as const
  }) as unknown as import("./identity-environment-manager.js").StoredLocalIdentityEnvironmentRecord;
  const candidate = stored("identity:candidate", "profile:candidate", [
    { account_system_ref: accountSystemA, account_ref: accountA, observation_ref: "observation:a", bound_at: at },
    { account_system_ref: accountSystemB, account_ref: accountB, observation_ref: "observation:b", bound_at: at }
  ]);
  const other = stored("identity:other-private", "profile:other-private", [
    { account_system_ref: accountSystemB, account_ref: accountB, observation_ref: "observation:other", bound_at: at }
  ]);
  const currentObservation = {
    identity_environment_ref: "identity:candidate", profile_ref: "profile:candidate", observed_at: at,
    observation_ref: "observation:current-a", account: { status: "verified", account_system_ref: accountSystemA, account_ref: accountA }
  } as unknown as ManagedObservation;

  const projection = profileIdentityOwnership([candidate, other], candidate, currentObservation);
  assert.equal(projection.current.status, "verified", "a unique current Account remains verified when another Account binding conflicts");
  assert.equal(projection.ownership.status, "conflict", "the existing Profile-wide summary remains global");
  assert.deepEqual(projection.history.bindings.map(binding => binding.ownership_status), ["unique", "conflict"]);
  assert.equal(hasManagedBindingConflict([candidate, other], candidate), true, "default callers keep Profile-wide conflict semantics");
  assert.equal(hasManagedBindingConflict([candidate, other], candidate, { account_system_ref: accountSystemA, account_ref: accountA }), false);
  assert.equal(hasManagedBindingConflict([candidate, other], candidate, { account_system_ref: accountSystemB, account_ref: accountB }), true);
  assert.equal(JSON.stringify(projection).includes("profile:other-private"), false, "the precise projection never exposes another Profile reference");

  (candidate as typeof candidate & { lifecycle_state?: string }).lifecycle_state = "archived";
  const archived = profileIdentityOwnership([candidate, other], candidate, null);
  assert.equal(archived.ownership.status, "not_runnable");
  assert.ok(archived.history.bindings.every(binding => binding.ownership_status === "not_runnable"));
});

test("v2 owner binding rechecks the observed Page and persists only after a fresh same-Page observation", async () => {
  const dir = mkdtempSync(join(tmpdir(), "managed-v2-binding-"));
  const origin = "https://github.com";
  const pages: LocalProviderPageState[] = [
    { provider_page_ref: "provider:a", current_url: `${origin}/other-user`, title: "Other", status: "ready", facts: [], active: true, document_generation: 1 },
    { provider_page_ref: "provider:b", current_url: `${origin}/octocat`, title: "Octocat", status: "ready", facts: [], active: false, document_generation: 1 }
  ];
  const observedPages: (string | undefined)[] = [];
  let changeDocumentDuringObservation = false;
  const pageController: LocalProviderPageController = {
    listPages: async () => structuredClone(pages),
    openPage: async () => structuredClone(pages[0]!),
    activatePage: async provider_page_ref => {
      for (const page of pages) page.active = page.provider_page_ref === provider_page_ref;
      return structuredClone(pages.find(page => page.provider_page_ref === provider_page_ref)!);
    },
    closePage: async provider_page_ref => {
      const index = pages.findIndex(page => page.provider_page_ref === provider_page_ref);
      if (index >= 0) pages.splice(index, 1);
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
      observePage: trustManagedPageObserver(async operation => {
        const selected = pages.find(page => page.provider_page_ref === operation?.provider_page_ref);
        observedPages.push(operation?.provider_page_ref);
        if (!selected) throw new Error("provider page missing");
        if (changeDocumentDuringObservation && selected.provider_page_ref === "provider:b") {
          selected.document_generation = (selected.document_generation ?? 1) + 1;
          changeDocumentDuringObservation = false;
        }
        return normalizeManagedProviderObservation({
          current_url: selected.current_url,
          title: selected.title,
          ready_state: "complete",
          stable_id: selected.provider_page_ref === "provider:b" ? "583231" : "832",
          account_source_kind: "github.profile_meta.self_match/v1",
          document_generation: selected.document_generation
        });
      })
    };
  };
  const options = { persistence_path: join(dir, "identities.json"), provider_detection: testProviderDetection };
  const runtime = new HarborRuntime(launcher, options);
  runtime.createLocalIdentityEnvironment({ ...identityInput("identity:v2-bind", "profile:v2-bind"), site: { site_id: "github", origin, display_name: "GitHub" } });
  const session = await runtime.openManagedIdentityEnvironmentSession({
    identity_environment_ref: "identity:v2-bind",
    url: `${origin}/other-user`,
    control_owner: "core_task",
    holder_ref: "principal:one",
    operation_scope: "profile_management",
    scope_semantics: "agent_operations_v2"
  });
  if ("status" in session) throw new Error("session unavailable");
  try {
    const listed = await runtime.operateManagedPage(session.runtime_session_ref, {
      operation: "page.list", holder_ref: "principal:one", authorized_origins: [origin], scope_semantics: "agent_operations_v2"
    });
    if (!("pages" in listed)) throw new Error("page list unavailable");
    const selected = listed.pages.find(page => page.current_url === `${origin}/octocat`)!;
    const observation = await runtime.observeManagedSession(session.runtime_session_ref, {
      holder_ref: "principal:one", scope_semantics: "agent_operations_v2", expected_origin: origin,
      page_id: selected.page_id, page_ref: selected.page_ref, document_generation: selected.document_generation
    });
    if (observation.status !== "completed") throw new Error(`observation unavailable: ${observation.failure_class}`);
    assert.equal(observation.page.page_ref, selected.page_ref);
    const bindInput = (observed: ManagedObservation, idempotency_key: string) => ({
      observation_ref: observed.observation_ref, runtime_session_ref: observed.runtime_session_ref,
      page_id: observed.page.page_id!, page_ref: observed.page.page_ref!, document_generation: observed.page.document_generation!,
      account_system_ref: observed.account.account_system_ref!, account_ref: observed.account.account_ref!, idempotency_key, holder_ref: "principal:one"
    });
    const staleBindInput = bindInput(observation, "bind:v2-during-observation-navigation");
    changeDocumentDuringObservation = true;
    assert.equal((await runtime.bindManagedAccount("identity:v2-bind", staleBindInput) as { failure_class?: string }).failure_class, "account_observation_changed");
    assert.deepEqual(observedPages, ["provider:b", "provider:b"], "owner recheck must use the Page from the trusted observation");

    const refreshed = await runtime.operateManagedPage(session.runtime_session_ref, {
      operation: "page.list", holder_ref: "principal:one", authorized_origins: [origin], scope_semantics: "agent_operations_v2"
    });
    if (!("pages" in refreshed)) throw new Error("refreshed page list unavailable");
    const current = refreshed.pages.find(page => page.current_url === `${origin}/octocat`)!;
    const currentObservation = await runtime.observeManagedSession(session.runtime_session_ref, {
      holder_ref: "principal:one", scope_semantics: "agent_operations_v2", expected_origin: origin,
      page_id: current.page_id, page_ref: current.page_ref, document_generation: current.document_generation
    });
    if (currentObservation.status !== "completed") throw new Error("current observation unavailable");
    assert.equal(currentObservation.account.account_ref, observation.account.account_ref);
    const bound = await runtime.bindManagedAccount("identity:v2-bind", bindInput(currentObservation, "bind:v2-page"));
    assert.ok("account_bindings" in bound && bound.account_bindings.length === 1 && "observation" in bound, JSON.stringify(bound));
    assert.deepEqual(observedPages, ["provider:b", "provider:b", "provider:b", "provider:b"], "owner recheck must retain the selected Page after a fresh observation");
    const persisted = new HarborRuntime(launcher, options).getManagedLocalIdentityEnvironment("identity:v2-bind");
    assert.ok(persisted?.account_bindings.some(binding => binding.account_ref === currentObservation.account.account_ref));
  } finally { await runtime.stopSession(session.runtime_session_ref); rmSync(dir, { recursive: true, force: true }); }
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
    const copied = reloaded.mutate({ operation: "copy_environment", identity_environment_ref: "legacy:a", idempotency_key: "environment-copy", expected_environment_template: {
      provider_id: "chrome_official",
      site: { site_id: "xiaohongshu", origin: "https://www.xiaohongshu.com", display_name: "xiaohongshu" },
      language: "en-US",
      timezone: "UTC"
    } });
    assert.equal(copied.status, "completed");
    assert.equal(copied.record?.site.account_ref, null);
    assert.deepEqual(copied.record?.account_bindings, []);
    assert.equal(copied.record?.status.login_state, "logged_out");
    const archived = reloaded.mutate({ operation: "archive", identity_environment_ref: "legacy:a", idempotency_key: "archive-bound-source" });
    assert.equal(archived.status, "completed");
    assert.equal(reloaded.get("legacy:a")?.site.account_ref, account_ref, "archive retains the historical binding fact");
    const afterArchive = new LocalIdentityEnvironmentManager(options);
    const runnableReplacement = afterArchive.create({ ...identityInput("legacy:b", "legacy:profile-b"), site: { site_id: "xiaohongshu", origin: "https://www.xiaohongshu.com", account_ref } });
    assert.equal(runnableReplacement.identity_environment_ref, "legacy:b", "an archived binding does not block the only runnable identity");
    assert.equal(afterArchive.get("legacy:a")?.site.account_ref, account_ref);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("legacy imported account refs outside the public projection bounds remain owner data", () => {
  const dir = mkdtempSync(join(tmpdir(), "managed-legacy-account-ref-"));
  try {
    const manager = new LocalIdentityEnvironmentManager({ persistence_path: join(dir, "identities.json") });
    const account_ref = ` legacy ${"x".repeat(260)}`;
    const imported = manager.importIdentityEnvironment({
      ...identityInput("legacy:long-ref", "legacy:profile-long-ref"),
      site: { site_id: "xiaohongshu", origin: "https://www.xiaohongshu.com", account_ref }
    });
    const projection = manager.listForManagedRead(() => null).find(item => item.identity_environment_ref === imported.identity_environment_ref);
    assert.equal(projection?.identity_ownership.history.declared, null, "unrepresentable legacy declaration is omitted from the bounded Agent projection");
    assert.equal(manager.getFacts(imported.identity_environment_ref)?.site_binding.account_ref, account_ref, "the original imported declaration remains persisted");
    assert.throws(() => manager.importIdentityEnvironment({
      ...identityInput("legacy:long-ref-duplicate", "legacy:profile-long-ref-duplicate"),
      site: { site_id: "xiaohongshu", origin: "https://www.xiaohongshu.com", account_ref }
    }), /account_binding_conflict/, "omitted declarations still participate in Harbor's existing ownership conflict predicate");
    const overlongSystemRef = manager.importIdentityEnvironment({
      ...identityInput("legacy:long-site-id", "legacy:profile-long-site-id"),
      site: { site_id: "s".repeat(250), origin: "https://www.xiaohongshu.com", account_ref: "account:valid" }
    });
    const systemRefProjection = manager.listForManagedRead(() => null).find(item => item.identity_environment_ref === overlongSystemRef.identity_environment_ref);
    assert.equal(systemRefProjection?.identity_ownership.history.declared, null, "an overlong derived AccountSystem ref is omitted");
    assert.equal(manager.getFacts(overlongSystemRef.identity_environment_ref)?.site_binding.site_id, "s".repeat(250), "the original Site ID remains persisted");
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
    commit: ["profile.create", "profile.copy_environment", "profile.archive", "profile.metadata.update", "account.bind"],
    destructive: ["profile.delete"],
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

test("GitHub account refs require the shared driver self-profile metadata verdict and a stable decimal ID", () => {
  const stableId = "583231";
  const verified = normalizeManagedProviderObservation({
    current_url: "https://github.com/octocat", title: "GitHub", ready_state: "complete", document_generation: 2,
    stable_id: stableId, account_source_kind: "github.profile_meta.self_match/v1"
  });
  assert.deepEqual(verified.account, {
    status: "verified", account_system_ref: "account-system:github",
    account_ref: `account:sha256:${createHash("sha256").update(JSON.stringify({ site_id: "github", stable_id: stableId })).digest("hex")}`
  });
  assert.equal(JSON.stringify(verified).includes(stableId), false, "the stable ID is hashed before Harbor returns the observation");
  for (const input of [
    { stable_id: null, account_source_kind: null },
    { stable_id: stableId, account_source_kind: null },
    { stable_id: "0", account_source_kind: "github.profile_meta.self_match/v1" },
    { stable_id: "58a231", account_source_kind: "github.profile_meta.self_match/v1" },
    { stable_id: stableId, account_source_kind: "github.profile_meta.self_match/v1", current_url: "https://github.com/octocat/repositories" },
    { stable_id: stableId, account_source_kind: "github.profile_meta.self_match/v1", current_url: "https://github.com.evil/octocat" },
    { stable_id: stableId, account_source_kind: "github.profile_meta.self_match/v1", ready_state: "loading" }
  ]) {
    const result = normalizeManagedProviderObservation({ current_url: "https://github.com/octocat", title: "GitHub", ready_state: "complete", ...input });
    assert.deepEqual(result.account, { status: "unknown", account_system_ref: null, account_ref: null });
  }
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

test("handback Page list preserves a same-holder binding and fences a different holder", async () => {
  const origin = "https://example.com";
  const pages: LocalProviderPageState[] = [{ provider_page_ref: "provider:one", current_url: `${origin}/one`, title: "One", status: "ready", facts: [], active: true, document_generation: 1 }];
  const pageController: LocalProviderPageController = {
    listPages: async () => structuredClone(pages),
    openPage: async () => structuredClone(pages[0]!),
    activatePage: async provider_page_ref => {
      for (const page of pages) page.active = page.provider_page_ref === provider_page_ref;
      return structuredClone(pages.find(page => page.provider_page_ref === provider_page_ref)!);
    },
    closePage: async provider_page_ref => {
      const index = pages.findIndex(page => page.provider_page_ref === provider_page_ref);
      if (index >= 0) pages.splice(index, 1);
      return structuredClone(pages);
    },
    navigatePage: async provider_page_ref => structuredClone(pages.find(page => page.provider_page_ref === provider_page_ref)!)
  };
  const launcher: LocalProviderLauncher = async input => {
    const ready = await createFixtureLauncher("ready")(input);
    if (ready.status !== "ready") throw new Error("fixture unavailable");
    return { ...ready, execution_surface: "local_provider", page: pages[0]!, pages, pageController };
  };
  const runtime = new HarborRuntime(launcher);
  runtime.createLocalIdentityEnvironment({ ...identityInput("identity:handback-pages", "profile:handback-pages"), site: { site_id: "public", origin, display_name: "Public" } });
  const session = await runtime.openManagedIdentityEnvironmentSession({ identity_environment_ref: "identity:handback-pages", url: `${origin}/one`, control_owner: "core_task", holder_ref: "principal:one", operation_scope: "profile_management" });
  if ("status" in session) throw new Error("session unavailable");
  try {
    assert.equal("status" in runtime.recordHandoff(session.runtime_session_ref, { control_owner: "user", handoff_reason: "user_requested" }), false);
    assert.equal("status" in runtime.releaseSession(session.runtime_session_ref, { control_owner: "user" }), false);
    const listed = await runtime.operateManagedPage(session.runtime_session_ref, { operation: "page.list", holder_ref: "principal:one", authorized_origins: [origin] });
    assert.equal(listed.status, "completed");
    if (!("pages" in listed)) throw new Error("page list unavailable");
    const selected = listed.pages[0]!;
    const generation = (runtime as unknown as { runtimeSessions: import("./runtime-session.js").RuntimeSessionStore }).runtimeSessions.getRecord(session.runtime_session_ref)!.control_generation;
    const claimed = runtime.lockSession(session.runtime_session_ref, { control_owner: "core_task", holder_ref: "principal:one" });
    assert.ok(!("status" in claimed));
    const activated = await runtime.operateManagedPage(session.runtime_session_ref, {
      operation: "page.activate", holder_ref: "principal:one", page_id: selected.page_id, page_ref: selected.page_ref,
      authorized_origins: [origin], operation_ref: "page-activate:same-holder"
    });
    assert.equal(activated.status, "completed");
    assert.equal((runtime as unknown as { runtimeSessions: import("./runtime-session.js").RuntimeSessionStore }).runtimeSessions.getRecord(session.runtime_session_ref)!.control_generation, generation);

    assert.equal("status" in runtime.recordHandoff(session.runtime_session_ref, { control_owner: "user", handoff_reason: "user_requested" }), false);
    assert.equal("status" in runtime.releaseSession(session.runtime_session_ref, { control_owner: "user" }), false);
    const relisted = await runtime.operateManagedPage(session.runtime_session_ref, { operation: "page.list", holder_ref: "principal:one", authorized_origins: [origin] });
    assert.equal(relisted.status, "completed");
    if (!("pages" in relisted)) throw new Error("page list unavailable");
    const old = relisted.pages[0]!;
    const otherClaim = runtime.lockSession(session.runtime_session_ref, { control_owner: "core_task", holder_ref: "principal:other" });
    assert.ok(!("status" in otherClaim));
    const stale = await runtime.operateManagedPage(session.runtime_session_ref, {
      operation: "page.activate", holder_ref: "principal:other", page_id: old.page_id, page_ref: old.page_ref,
      authorized_origins: [origin], operation_ref: "page-activate:different-holder"
    });
    assert.equal(stale.status, "unavailable");
    if (!("failure_class" in stale)) throw new Error("stale page failure missing");
    assert.equal(stale.failure_class, "stale_page");
    assert.equal(stale.dispatch_state, "not_dispatched");
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
