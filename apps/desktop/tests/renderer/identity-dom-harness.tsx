import { useState } from "react";
import { createRoot } from "react-dom/client";

import { IdentityEnvironmentsPage } from "../../src/renderer/IdentityEnvironmentsPage";
import type { IdentityEnvironmentMutationFailureCode } from "../../src/renderer/harborIdentityMutationClient";
import { identitySelectionStorageKey, type HarborIdentityLoadState } from "../../src/renderer/harborIdentityTypes";
import type { TaskProjection } from "../../src/renderer/taskThreadFixtures";
import { runtime } from "./library-harness-fixtures";
import "../../src/renderer/uiFoundation.css";
import "../../src/renderer/styles.css";

type OwnerRequest = WebEnvoyOwnerApiJsonRequest;

const requests: OwnerRequest[] = [];
let nextFailure: IdentityEnvironmentMutationFailureCode | null = null;
let offline = false;
let identityOffline = false;
let unknownMutationResult = false;
let providerUnavailable = false;
let providerPreference: NonNullable<HarborIdentityLoadState["providerPreference"]> = {
  schema_version: "harbor-browser-provider-preference/v1",
  project_recommendation: { provider_id: "cloakbrowser", availability: "available", unavailable_reason: null },
  user_creation_default: { provider_id: "cloakbrowser", availability: "available", unavailable_reason: null, updated_at: "2026-07-22T00:00:00Z" },
};
let facts = [identityFact("identity-env_aaaaaaaaaaaaaaaaaaaaaaaa", "品牌运营号", "xiaohongshu", "camoufox"), identityFact("identity-env_bbbbbbbbbbbbbbbbbbbbbbbb", "招聘观察号", "boss")];

installOwnerMock();

function Harness() {
  const [generation, setGeneration] = useState(0);
  const initialState: HarborIdentityLoadState = {
    status: "ready", fetchedAt: "2026-07-22T00:00:00Z", summary: "ready", identities: [], providers: providerCatalog().providers,
    providerPreference
  };
  return <main className="identity-harness"><header className="shell-topbar production-topbar"><div className="topbar-center-surface"><h2>账号身份</h2><div id="identity-topbar-actions" className="prototype-center-actions" /></div></header><button hidden data-test-offline type="button" onClick={() => { offline = true; }}>offline</button><button hidden data-test-identity-offline type="button" onClick={() => { identityOffline = true; }}>identity-offline</button><button hidden data-test-empty type="button" onClick={() => { offline = false; identityOffline = false; facts = []; setGeneration((value) => value + 1); }}>empty</button><button hidden data-test-reopen type="button" onClick={() => setGeneration((value) => value + 1)}>reopen</button><button hidden data-test-set-default type="button" onClick={() => { providerUnavailable = false; providerPreference = { ...providerPreference, user_creation_default: { provider_id: "chrome_official", availability: "available", unavailable_reason: null, updated_at: "2026-07-22T00:00:00Z" } }; setGeneration((value) => value + 1); }}>set-default</button><button hidden data-test-provider-unavailable type="button" onClick={() => { providerUnavailable = true; providerPreference = { ...providerPreference, user_creation_default: { ...providerPreference.user_creation_default, availability: "unavailable", unavailable_reason: "Provider 当前不可启动" } }; setGeneration((value) => value + 1); }}>provider-unavailable</button><IdentityEnvironmentsPage key={generation} harborEndpoint="http://127.0.0.1:8790" initialState={initialState} runtimeSupervisorState={runtime} tasks={tasks} onHarborStateChange={() => {}} onOpenLibrary={() => {}} onOpenSettings={() => {}} /></main>;
}

createRoot(document.getElementById("root")!).render(<Harness />);

window.__runIdentityDomSmoke = async (mode) => {
  await waitUntil(() => document.querySelectorAll(".identity-catalog-row").length === 2, "identity catalog");
  if (mode === "provider-default") {
    async function returnToCatalog(label: string) {
      document.querySelector<HTMLButtonElement>(".identity-editor-actions button:not(.primary)")?.click();
      await waitUntil(() => document.querySelector(".identity-detail-title") != null, `${label} detail`);
      document.querySelector<HTMLButtonElement>(".identity-back-link")?.click();
      await waitUntil(() => document.querySelector(".identity-catalog-header") != null, `${label} catalog`);
    }
    function oldProfileRow() {
      const row = Array.from(document.querySelectorAll<HTMLButtonElement>(".identity-catalog-row")).find((candidate) => candidate.textContent?.includes("品牌运营号"));
      if (!row) throw new Error("Missing old Camoufox identity.");
      return row;
    }
    async function openOldProfile(label: string) {
      oldProfileRow().click();
      await waitUntil(() => document.querySelector(".identity-detail-title") != null, `${label} detail`);
    }
    async function openCreate(label: string) {
      clickButton("创建账号身份");
      await waitUntil(() => document.querySelector(".identity-editor") != null, `${label} create form`);
    }
    async function openImport(label: string) {
      clickButton("导入");
      await waitUntil(() => document.querySelector(".identity-editor") != null, `${label} import form`);
    }
    function providerValue() { return document.querySelector<HTMLSelectElement>("select[name='providerId']")?.value ?? ""; }
    function assertFreshEnvironment(modeLabel: string) {
      if (document.querySelector<HTMLSelectElement>("select[name='proxyMode']")?.value !== "system") throw new Error(`${modeLabel} reused the old proxy mode.`);
      for (const name of ["language", "timezone", "viewport"]) {
        const field = document.querySelector<HTMLInputElement | HTMLSelectElement>(`[name='${name}']`);
        if (field?.value) throw new Error(`${modeLabel} reused an environment field: ${name}, provider=${providerValue()}.`);
      }
    }
    function latestMutation(operation: string) {
      return requests.filter((request) => request.path === "/runtime/identity-environment-mutations" && (request.body as { operation?: string }).operation === operation).at(-1)?.body as Record<string, unknown> | undefined;
    }

    await openOldProfile("old Profile");
    const oldRef = window.localStorage.getItem(identitySelectionStorageKey);
    if (!oldRef) throw new Error("Viewing the old Profile did not persist selectedId.");
    document.querySelector<HTMLButtonElement>(".identity-back-link")?.click();
    await waitUntil(() => document.querySelector(".identity-catalog-header") != null, "catalog after old identity");

    setSelect("Provider 新建默认", "chrome_official");
    await twoFrames();
    clickButton("保存默认");
    await waitUntil(() => document.body.textContent?.includes("已保存新建默认") === true, "save Chrome creation default");

    await openCreate("saved Chrome default after old Profile");
    if (providerValue() !== "chrome_official") throw new Error("Create did not use the saved creation default after viewing an old Profile.");
    if (document.querySelector<HTMLInputElement>("[name='accountIdentifier']")?.value !== "") throw new Error("Create inherited old Profile form data.");
    assertFreshEnvironment("saved-default create");
    await returnToCatalog("saved Chrome default");

    clickButton("清除默认");
    await waitUntil(() => document.body.textContent?.includes("已清除新建默认") === true, "clear creation default");
    await openCreate("unset default after old Profile");
    if (providerValue() !== "") throw new Error("Create fell back to the old Profile after clearing the default.");
    assertFreshEnvironment("unset-default create");
    await returnToCatalog("unset default");

    await openImport("explicit import after old Profile");
    if (providerValue() !== "" || document.querySelector<HTMLInputElement>("[name='accountIdentifier']")?.value !== "" || document.querySelector<HTMLInputElement>("[name='importSourceRef']")?.value !== "") throw new Error("Import inherited old Profile or creation form input.");
    assertFreshEnvironment("explicit import");
    await returnToCatalog("explicit import");

    document.querySelector<HTMLButtonElement>("[data-test-reopen]")?.click();
    await waitUntil(() => document.querySelector(".identity-catalog-header") != null, "catalog after component reopen");
    if (window.localStorage.getItem(identitySelectionStorageKey) !== oldRef) throw new Error("Component reopen did not retain selectedId.");
    await openCreate("reopened unset default");
    if (providerValue() !== "") throw new Error("Reopened create inherited the persisted old Profile.");
    assertFreshEnvironment("reopened create");
    await returnToCatalog("reopened create");
    await openImport("reopened import");
    if (providerValue() !== "") throw new Error("Reopened import inherited the persisted old Profile.");
    assertFreshEnvironment("reopened import");
    await returnToCatalog("reopened import");

    await openOldProfile("edit binding");
    document.querySelector<HTMLButtonElement>("[aria-label='编辑身份']")?.click();
    await waitUntil(() => document.querySelector(".identity-editor") != null, "edit form");
    if (providerValue() !== "camoufox" || document.querySelector<HTMLSelectElement>("select[name='proxyMode']")?.value !== "preserve") throw new Error("Edit did not preserve the Profile's actual Camoufox binding or environment.");
    if (document.querySelector("[name='accountIdentifier']") || document.querySelector("[name='importSourceRef']")) throw new Error("Edit exposed create/import-only inputs.");
    await returnToCatalog("edit binding");

    document.querySelector<HTMLButtonElement>("[data-test-set-default]")?.click();
    await waitUntil(() => document.querySelector(".identity-catalog-header") != null, "valid default for explicit override");
    await openCreate("explicit override");
    if (providerValue() !== "chrome_official") throw new Error("Explicit override test did not start from the valid default.");
    setSelect("浏览器 Provider", "camoufox");
    await nextFrame();
    if (providerValue() !== "camoufox") throw new Error("Explicit Provider selection did not update the form.");
    fillInput("accountIdentifier", "显式 Camoufox 账号");
    document.querySelector<HTMLButtonElement>(".identity-editor-actions .primary")?.click();
    await waitUntil(() => document.body.textContent?.includes("账号身份已创建") === true, "explicit override create");
    const explicitCreate = latestMutation("create");
    if ((explicitCreate?.identity_environment as { requested_provider_id?: string } | undefined)?.requested_provider_id !== "camoufox") throw new Error("Explicit Provider did not override the saved default in the create request.");
    document.querySelector<HTMLButtonElement>(".identity-back-link")?.click();
    await waitUntil(() => document.querySelector(".identity-catalog-header") != null, "catalog after explicit override");
    await openOldProfile("unavailable default setup");
    document.querySelector<HTMLButtonElement>(".identity-back-link")?.click();
    await waitUntil(() => document.querySelector(".identity-catalog-header") != null, "catalog before unavailable default");
    document.querySelector<HTMLButtonElement>("[data-test-provider-unavailable]")?.click();
    await waitUntil(() => document.querySelector(".identity-catalog-header") != null, "unavailable default catalog");
    if (!document.body.textContent?.includes("Provider 当前不可启动")) throw new Error("Unavailable default reason was not retained in the UI.");
    await openCreate("unavailable default");
    if (providerValue() !== "" || !document.body.textContent?.includes("Provider 当前不可启动")) throw new Error("Unavailable default fell back to the old Profile or lost its reason.");
    assertFreshEnvironment("unavailable-default create");
    fillInput("accountIdentifier", "不可用默认不应创建");
    const beforeUnavailableSubmit = requests.length;
    document.querySelector<HTMLButtonElement>(".identity-editor-actions .primary")?.click();
    await nextFrame();
    if (requests.length !== beforeUnavailableSubmit) throw new Error("Unavailable default submitted a create without an explicit Provider.");
    await returnToCatalog("unavailable default");

    document.querySelector<HTMLButtonElement>("[data-test-set-default]")?.click();
    await waitUntil(() => document.querySelector(".identity-catalog-header") != null, "catalog before mode isolation");
    await openCreate("create input isolation");
    fillInput("accountIdentifier", "create-only-account");
    setSelect("浏览器 Provider", "camoufox");
    await nextFrame();
    fillInput("language", "create-only-language");
    await returnToCatalog("create input isolation");
    await openImport("import input isolation");
    if (providerValue() !== "" || document.querySelector<HTMLInputElement>("[name='accountIdentifier']")?.value !== "" || document.querySelector<HTMLInputElement>("[name='importSourceRef']")?.value !== "") throw new Error("Import reused create input.");
    setSelect("浏览器 Provider", "camoufox");
    await nextFrame();
    fillInput("accountIdentifier", "import-only-account");
    fillInput("importSourceRef", "import-only-source");
    fillInput("language", "import-only-language");
    await returnToCatalog("import input isolation");
    await openOldProfile("edit input isolation");
    document.querySelector<HTMLButtonElement>("[aria-label='编辑身份']")?.click();
    await waitUntil(() => document.querySelector(".identity-editor") != null, "edit input isolation form");
    if (providerValue() !== "camoufox" || document.querySelector<HTMLInputElement>("[name='language']")?.value !== "zh-CN") throw new Error("Edit reused import input instead of the Profile environment.");
    fillInput("language", "edit-only-language");
    await returnToCatalog("edit input isolation");
    await openCreate("post-edit create isolation");
    if (providerValue() !== "chrome_official" || document.querySelector<HTMLInputElement>("[name='accountIdentifier']")?.value !== "") throw new Error("Create reused edit input or defaulted to the wrong Provider.");
    assertFreshEnvironment("post-edit create");
    await returnToCatalog("post-edit create isolation");
    await openImport("post-edit import isolation");
    if (providerValue() !== "" || document.querySelector<HTMLInputElement>("[name='accountIdentifier']")?.value !== "" || document.querySelector<HTMLInputElement>("[name='importSourceRef']")?.value !== "") throw new Error("Import reused edit input.");
    assertFreshEnvironment("post-edit import");
    return { oldProfileSelection: true, creationDefault: true, clearedDefault: true, importExplicit: true, persistedSelection: true, editBinding: true, explicitOverride: true, unavailableDefault: true, modeIsolation: true };
  }
  if (mode === "narrow") {
    document.querySelector<HTMLButtonElement>(".identity-catalog-row")?.click();
    await waitUntil(() => document.querySelector(".identity-detail-title") != null, "narrow identity detail");
    assertNoOverflow("narrow identity detail");
    document.querySelector<HTMLElement>(".identity-copy-menu summary")?.click();
    await nextFrame();
    assertNoOverflow("narrow copy menu");
    document.querySelector<HTMLButtonElement>("[aria-label='编辑身份']")?.click();
    await waitUntil(() => document.querySelector(".identity-editor") != null, "narrow identity editor");
    assertNoOverflow("narrow identity editor");
    document.querySelector<HTMLButtonElement>(".identity-editor-actions button:not(.primary)")?.click();
    await waitUntil(() => document.querySelector(".identity-detail-title") != null, "narrow detail after editor");
    clickButton("从 App 移除");
    await waitUntil(() => document.querySelector(".identity-removal-dialog") != null, "narrow removal dialog");
    const focusable = Array.from(document.querySelectorAll<HTMLElement>(".identity-removal-dialog button:not(:disabled), .identity-removal-dialog input:not(:disabled)"));
    focusable.at(-1)?.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    if (document.activeElement !== focusable[0]) throw new Error("Removal dialog did not trap forward Tab focus.");
    assertNoOverflow("narrow catalog");
    return { mode, detail: true, editor: true, copyMenu: true, dialogFocusTrap: true, overflow: false };
  }
  const initialRows = Array.from(document.querySelectorAll<HTMLButtonElement>(".identity-catalog-row"));
  if (!initialRows[0]?.textContent?.includes("招聘观察号") || document.querySelectorAll("[aria-label^='账号状态：']").length !== 2) throw new Error("Recent-use sorting or accessible statuses are missing.");
  setInput(document.querySelector("[aria-label='搜索账号身份']"), "品牌");
  await waitUntil(() => document.querySelectorAll(".identity-catalog-row").length === 1, "identity search");
  setInput(document.querySelector("[aria-label='搜索账号身份']"), "");
  setSelect("筛选站点", "BOSS");
  await waitUntil(() => document.querySelectorAll(".identity-catalog-row").length === 1, "site filter");
  setSelect("筛选站点", "全部站点");
  setSelect("排序", "site");
  await twoFrames();
  document.querySelector<HTMLButtonElement>(".identity-catalog-row")?.click();
  await waitUntil(() => document.querySelector(".identity-detail-title") != null, "identity detail");
  clickButton("打开浏览器");
  await waitUntil(() => document.body.textContent?.includes("已完成，继续") === true, "browser takeover");
  clickButton("已完成，继续");
  await waitUntil(() => document.body.textContent?.includes("任务可以继续") === true, "authentication completion");
  if (!requests.some((request) => request.path === "/runtime/sessions/session_public/release")) throw new Error("Authentication completion did not release the Harbor session.");
  if (document.body.textContent?.includes("已完成，继续")) throw new Error("Authentication completion left the session in user takeover.");
  const copy = document.querySelector<HTMLDetailsElement>(".identity-copy-menu")!;
  const summary = copy.querySelector<HTMLElement>("summary")!;
  summary.click();
  summary.focus();
  copy.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await nextFrame();
  if (copy.open || document.activeElement !== summary) throw new Error("Copy menu did not close and restore focus on Escape.");
  for (const [code, text] of [["active_session", "运行中的浏览器"], ["profile_locked", "正在使用中"], ["proxy_unreachable", "代理或 Provider"], ["repair_required", "需要修复"]] as const) {
    nextFailure = code;
    summary.click();
    copy.querySelectorAll<HTMLButtonElement>("[role='menuitem']")[0]?.click();
    await waitUntil(() => document.body.textContent?.includes(text) === true, `${code} recovery message`);
  }
  summary.click();
  copy.querySelectorAll<HTMLButtonElement>("[role='menuitem']")[1]?.click();
  await waitUntil(() => document.body.textContent?.includes("仅含环境配置的副本") === true, "environment copy");
  const retryStart = requests.length;
  unknownMutationResult = true;
  summary.click();
  copy.querySelectorAll<HTMLButtonElement>("[role='menuitem']")[1]?.click();
  await waitUntil(() => document.body.textContent?.includes("未确认本次变更结果") === true, "unknown mutation result");
  summary.click();
  copy.querySelectorAll<HTMLButtonElement>("[role='menuitem']")[1]?.click();
  await waitUntil(() => document.body.textContent?.includes("仅含环境配置的副本") === true, "idempotent mutation retry");
  const retryBodies = requests.slice(retryStart).filter((request) => request.path === "/runtime/identity-environment-mutations").map((request) => request.body as { idempotency_key?: string });
  if (retryBodies.length !== 2 || retryBodies[0]?.idempotency_key !== retryBodies[1]?.idempotency_key) throw new Error("Unknown mutation retry did not reuse its idempotency key.");
  document.querySelector<HTMLButtonElement>("[aria-label='编辑身份']")?.click();
  await waitUntil(() => document.querySelector(".identity-editor") != null, "identity editor");
  setSelect("浏览器 Provider", "chrome_official");
  document.querySelector<HTMLButtonElement>(".identity-editor-actions .primary")?.click();
  await waitUntil(() => document.body.textContent?.includes("账号身份配置已更新") === true, "identity edit");
  document.querySelector<HTMLButtonElement>(".identity-back-link")?.click();
  await waitUntil(() => document.querySelector(".identity-catalog-header") != null, "catalog after edit");
  clickButton("创建账号身份");
  await waitUntil(() => document.querySelector(".identity-editor") != null, "create identity form");
  if (document.querySelector<HTMLSelectElement>("select[name='providerId']")?.value !== "cloakbrowser") throw new Error("Create did not use the saved creation default.");
  fillInput("accountIdentifier", "新建运营号");
  document.querySelector<HTMLButtonElement>(".identity-editor-actions .primary")?.click();
  await waitUntil(() => document.body.textContent?.includes("账号身份已创建") === true, "identity create");
  document.querySelector<HTMLButtonElement>(".identity-back-link")?.click();
  await waitUntil(() => document.querySelector(".identity-catalog-header") != null, "catalog after create");
  clickButton("导入");
  await waitUntil(() => document.querySelector(".identity-editor") != null, "import identity form");
  if (document.querySelector<HTMLSelectElement>("select[name='providerId']")?.value !== "") throw new Error("Import inherited the creation-only default.");
  setSelect("浏览器 Provider", "chrome_official");
  fillInput("accountIdentifier", "导入运营号");
  fillInput("importSourceRef", "import-source-public");
  document.querySelector<HTMLButtonElement>(".identity-editor-actions .primary")?.click();
  await waitUntil(() => document.body.textContent?.includes("账号身份已导入") === true, "identity import");
  const removeButton = findButton("从 App 移除");
  removeButton.focus();
  removeButton.click();
  await waitUntil(() => document.querySelector(".identity-removal-dialog") != null, "remove confirmation");
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await waitUntil(() => document.querySelector(".identity-removal-dialog") == null, "remove confirmation Escape");
  if (document.activeElement !== removeButton) throw new Error("Removal confirmation did not restore trigger focus.");
  removeButton.click();
  await waitUntil(() => document.querySelector(".identity-removal-dialog") != null, "reopened remove confirmation");
  clickButton("确认移除");
  await waitUntil(() => document.querySelector(".identity-catalog-header") != null, "removed identity catalog");
  Array.from(document.querySelectorAll<HTMLButtonElement>(".identity-catalog-row")).find((row) => row.textContent?.includes("新建运营号"))?.click();
  await waitUntil(() => document.querySelector(".identity-detail-title") != null, "created identity detail");
  clickButton("删除本机数据");
  await waitUntil(() => document.querySelector(".identity-removal-dialog") != null, "delete confirmation");
  fillInputIn(document.querySelector(".identity-removal-dialog input"), "新建运营号");
  Array.from(document.querySelectorAll<HTMLButtonElement>(".identity-removal-dialog button")).find((button) => button.textContent?.includes("删除本机数据"))?.click();
  await waitUntil(() => document.querySelector(".identity-catalog-header") != null, "deleted identity catalog");
  const mutationBodies = requests.filter((request) => request.path === "/runtime/identity-environment-mutations").map((request) => JSON.stringify(request.body));
  for (const operation of ["copy_environment", "edit", "create", "import", "remove", "delete"]) if (!mutationBodies.some((body) => body.includes(`"operation":"${operation}"`))) throw new Error(`Missing owner mutation: ${operation}`);
  if (mutationBodies.some((body) => /cookie|password|token|profile_ref|identity_environment":\{[^}]*identity_environment_ref/i.test(body))) throw new Error("Mutation requests exposed sensitive material.");
  const editBody = mutationBodies.find((body) => body.includes('"operation":"edit"')) ?? "";
  if (/proxy_label|region|interaction_preset|fingerprint_strategy/.test(editBody)) throw new Error(`Identity edit reconstructed unsupported or display-only configuration: ${editBody}`);
  document.querySelector<HTMLButtonElement>("[data-test-empty]")?.click();
  await waitUntil(() => document.body.textContent?.includes("尚未创建账号身份") === true, "empty identity catalog");
  document.querySelector<HTMLButtonElement>(".identity-empty button")?.click();
  await waitUntil(() => document.querySelector(".identity-editor") != null, "create from empty catalog");
  document.querySelector<HTMLButtonElement>(".identity-editor-actions button:not(.primary)")?.click();
  await waitUntil(() => document.querySelector(".identity-catalog-header") != null, "catalog after empty create");
  document.querySelector<HTMLButtonElement>("[data-test-identity-offline]")?.click();
  document.querySelector<HTMLButtonElement>("[aria-label='刷新账号身份']")?.click();
  await waitUntil(() => document.querySelector(".identity-connection-notice") != null, "identity endpoint fail-closed state");
  if (document.querySelector<HTMLButtonElement>(".identity-catalog-header button.primary")?.disabled !== true) throw new Error("Provider-only readback enabled identity mutations.");
  identityOffline = false;
  document.querySelector<HTMLButtonElement>("[data-test-offline]")?.click();
  document.querySelector<HTMLButtonElement>("[aria-label='刷新账号身份']")?.click();
  await waitUntil(() => document.querySelector(".identity-connection-notice") != null, "offline read-only state");
  if (!Array.from(document.querySelectorAll<HTMLButtonElement>(".identity-catalog-header button:not([aria-label='刷新账号身份'])")).every((button) => button.disabled)) throw new Error("Offline identity state did not fail closed for mutations.");
  assertNoOverflow("desktop identity workbench");
  return { mode, search: true, filters: true, statusLabels: true, copyFocus: true, failures: true, allMutations: true, mutationsRedacted: true, offlineReadOnly: true, emptyCreate: true, overflow: false };
};

function installOwnerMock() {
  window.webenvoyShell = {
    completeHarborManualAuthentication: async () => ({
      ...facts[0],
      login_state: { ...facts[0].login_state, manual_authentication_state: "completed" },
      status: { authentication_provenance: "user_confirmed_managed_session" },
    }),
    requestOwnerJson: async (request) => {
      requests.push(structuredClone(request));
      if (offline) return { ok: false, status: 503, error: "owner unavailable" };
      if (request.path === "/runtime/browser-providers") return { ok: true, body: providerCatalog() };
      if (request.path === "/runtime/browser-provider-preference") {
        if (request.method === "POST") {
          const body = request.body as { operation?: string; provider_id?: string };
          if (body.operation === "set" && typeof body.provider_id === "string") {
            providerPreference = { ...providerPreference, user_creation_default: { provider_id: body.provider_id, availability: "available", unavailable_reason: null, updated_at: "2026-07-22T00:00:00Z" } };
          } else if (body.operation === "clear") {
            providerPreference = { ...providerPreference, user_creation_default: { provider_id: null, availability: "unset", unavailable_reason: null, updated_at: "2026-07-22T00:00:00Z" } };
          }
          return { ok: true, body: { schema_version: "harbor-browser-provider-preference-mutation/v1", operation: body.operation, status: "completed", preference: providerPreference, failure: null } };
        }
        return { ok: true, body: providerPreference };
      }
      if (identityOffline && request.path.includes("identity-environments")) return { ok: false, status: 503, error: "identity owner unavailable" };
      if (request.path === "/runtime/identity-environments") return { ok: true, body: { items: facts } };
      if (request.path === "/runtime/identity-environment-mutations") return mutationResponse(request);
      if (request.path === "/runtime/identity-environment-sessions") return { ok: true, body: runtimeSession() };
      if (request.path === "/runtime/sessions/session_public/release") return { ok: true, body: runtimeSession("none") };
      return { ok: false, status: 404, error: "not found" };
    },
  };
}

function mutationResponse(request: OwnerRequest) {
  const body = request.body as Record<string, unknown>;
  const operation = String(body.operation);
  if (unknownMutationResult) {
    unknownMutationResult = false;
    return { ok: false, error: "request timed out" };
  }
  if (nextFailure) {
    const code = nextFailure;
    nextFailure = null;
    return { ok: false, status: 409, error: code, body: mutationResult(operation, "rejected", null, code) };
  }
  const sourceRef = typeof body.identity_environment_ref === "string" ? body.identity_environment_ref : null;
  let targetRef = sourceRef;
  if (operation === "create" || operation === "import") {
    targetRef = `identity-env_${String(facts.length + 1).padStart(24, "c")}`;
    const input = body.identity_environment as { site?: { account_identifier?: string; site_id?: string }; requested_provider_id?: "cloakbrowser" | "chrome_official" | "camoufox" };
    facts = [...facts, identityFact(targetRef, input.site?.account_identifier ?? "新账号", input.site?.site_id === "boss" ? "boss" : "xiaohongshu", input.requested_provider_id ?? "cloakbrowser")];
  } else if (operation.startsWith("copy_")) {
    targetRef = `identity-env_${String(facts.length + 1).padStart(24, "d")}`;
    const source = facts.find((fact) => fact.identity_environment_ref === sourceRef)!;
    facts = [...facts, { ...source, identity_environment_ref: targetRef, execution_identity_ref: `${targetRef}:execution`, profile_ref: `${targetRef}:profile`, site_binding: { ...source.site_binding, account_label: `${source.site_binding.account_label} 副本` } }];
  } else if (operation === "remove" || operation === "delete") {
    facts = facts.filter((fact) => fact.identity_environment_ref !== sourceRef);
  }
  return { ok: true, body: mutationResult(operation, "completed", targetRef, null) };
}

function mutationResult(operation: string, status: "completed" | "rejected", ref: string | null, code: IdentityEnvironmentMutationFailureCode | null) {
  return { schema_version: "harbor-identity-environment-mutation/v1", operation, status, identity_environment_ref: ref, source_identity_environment_ref: null, record: null, effects: { index: status === "completed" ? "updated" : "unchanged", local_data: "unchanged", login_state: "unchanged" }, failure: code ? { code, retryable: true, recovery_actions: [] } : null, public_boundary: { output: "status_and_redacted_refs_only", raw_material: "not_exposed", not_exposed: ["cookie", "token", "password", "profile_storage", "local_path"] } };
}

function identityFact(ref: string, account: string, siteId: "xiaohongshu" | "boss", providerId: "cloakbrowser" | "chrome_official" | "camoufox" = "cloakbrowser") {
  const boss = siteId === "boss";
  return { schema_version: "harbor-local-identity-environment/v0", identity_environment_ref: ref, execution_identity_ref: `${ref}:execution`, profile_ref: `${ref}:profile`, site_binding: { site_id: siteId, origin: boss ? "https://www.zhipin.com" : "https://www.xiaohongshu.com", display_name: boss ? "BOSS" : "小红书", account_label: account }, login_state: { state: "logged_in", reason: null, recovery_required: false, manual_authentication_state: "not_required", human_verification: [] }, browser_storage: { profile_storage_ref: `${ref}:storage`, state: "present", cookies_session_state: "present" }, environment: { proxy: { state: "configured", proxy_ref: "proxy_ref_public", label: "团队推荐线路" }, region: "CN-SH", geoip_mode: "proxy", language: "zh-CN", timezone: "Asia/Shanghai", browser_family: providerId, user_agent_summary: "Chrome family", viewport: "1440x900", hardware_concurrency: 8, device_memory_gb: 8, gpu_profile: "desktop-default", interaction_preset: "default", fingerprint_strategy: "provider_default", fingerprint_summary: "provider default" }, provider_binding: { selected_provider_id: providerId, selection_reason: "configured", requires_user_notice: providerId === "chrome_official", selected_provider: providerCatalog().providers.find((provider) => provider.provider_id === providerId) ?? null, warnings: [], unavailable_reason: null }, credential_recovery: { credential_ref: null, recovery_actions: [] }, diagnostics: [] };
}

function providerCatalog() { return { schema_version: "harbor-browser-provider-status/v0", providers: [{ provider_id: "cloakbrowser", display_name: "CloakBrowser", role: "primary", install: { status: "installed", path: null, version: "test", launchability: "launchable", reason: null }, capabilities: [{ key: "proxy", state: "supported", source: "runtime_verification" }, { key: "locale", state: "supported", source: "runtime_verification" }, { key: "timezone", state: "supported", source: "runtime_verification" }, { key: "viewport", state: "supported", source: "runtime_verification" }] }, { provider_id: "chrome_official", display_name: "官方 Chrome", role: "restricted_fallback", install: { status: providerUnavailable ? "missing" : "installed", path: null, version: "test", launchability: providerUnavailable ? "not_checked" : "launchable", reason: providerUnavailable ? "Provider 当前不可启动" : null }, capabilities: [] }, { provider_id: "camoufox", display_name: "Camoufox", role: "qualification", install: { status: "installed", path: null, version: "test", launchability: "launchable", reason: null }, capabilities: [{ key: "locale", state: "supported", source: "runtime_verification" }, { key: "timezone", state: "supported", source: "runtime_verification" }, { key: "viewport", state: "supported", source: "runtime_verification" }] }], excluded_providers: [] } as const; }
function runtimeSession(controlOwner: "user" | "none" = "user") { return { schema_version: "harbor-runtime-facts/v0", runtime_session_ref: "session_public", provider_ref: "provider_public", lifecycle_state: "active", created_at: "2026-07-22T00:00:00Z", last_seen_at: "2026-07-22T00:00:01Z", current_page: { requested_url: "https://www.xiaohongshu.com", current_url: "https://www.xiaohongshu.com", title: "小红书", status: "ready" }, control_owner: controlOwner, control_lock: { owner: controlOwner, state: controlOwner === "user" ? "held" : "released" }, current_error: null }; }

const tasks = [{ id: "task-a", title: "A", accountIdentity: "A", siteSkill: "A", businessInput: "", source: "Core live", packageSource: { name: "A", version: "1", capabilityRef: "A", sourceRef: "A", fetchedAt: "", source: "Core live", boundary: "" }, runs: [], updatedAt: "2026-07-20T00:00:00Z", threadContext: { siteLabel: "小红书", siteSkillKey: "A", accountIdentityKey: "identity-env_aaaaaaaaaaaaaaaaaaaaaaaa" } }, { id: "task-b", title: "B", accountIdentity: "B", siteSkill: "B", businessInput: "", source: "Core live", packageSource: { name: "B", version: "1", capabilityRef: "B", sourceRef: "B", fetchedAt: "", source: "Core live", boundary: "" }, runs: [], updatedAt: "2026-07-22T00:00:00Z", threadContext: { siteLabel: "BOSS", siteSkillKey: "B", accountIdentityKey: "identity-env_bbbbbbbbbbbbbbbbbbbbbbbb" } }] satisfies TaskProjection[];

function setInput(element: Element | null, value: string) { const input = element as HTMLInputElement; const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set; setter?.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); }
function fillInput(name: string, value: string) { fillInputIn(document.querySelector(`[name='${name}']`), value); }
function fillInputIn(element: Element | null, value: string) { if (!element) throw new Error("Missing input."); setInput(element, value); }
function findButton(text: string) { const button = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((item) => item.textContent?.trim().includes(text)); if (!button) throw new Error(`Missing button: ${text}`); return button; }
function clickButton(text: string) { findButton(text).click(); }
function setSelect(label: string, value: string) { const select = document.querySelector<HTMLSelectElement>(`select[aria-label='${label}']`) ?? Array.from(document.querySelectorAll("label")).find((item) => item.textContent?.startsWith(label))?.querySelector("select"); if (!select) throw new Error(`Missing select: ${label}`); const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set; if (!setter) throw new Error("Missing select value setter."); setter.call(select, value); select.dispatchEvent(new Event("change", { bubbles: true })); }
function nextFrame() { return new Promise<void>((resolve) => requestAnimationFrame(() => resolve())); }
async function twoFrames() { await nextFrame(); await nextFrame(); }
async function waitUntil(predicate: () => boolean, label: string) { for (let attempt = 0; attempt < 120; attempt += 1) { if (predicate()) return; await nextFrame(); } const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>(".identity-catalog-header button, .identity-empty button")).map((button) => `${button.textContent}:${button.disabled}`); throw new Error(`Timed out waiting for ${label}: ${document.body.textContent?.slice(-500)} buttons=${buttons.join("|")}.`); }
function assertNoOverflow(label: string) { const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth; if (overflow > 1) throw new Error(`${label} overflowed by ${overflow}px.`); }

declare global { interface Window { __runIdentityDomSmoke: (mode: "desktop" | "narrow" | "provider-default") => Promise<unknown>; } }
