import { useState } from "react";
import { createRoot } from "react-dom/client";

import { IdentityEnvironmentsPage } from "../../src/renderer/IdentityEnvironmentsPage";
import type { IdentityEnvironmentMutationFailureCode } from "../../src/renderer/harborIdentityMutationClient";
import type { HarborIdentityLoadState } from "../../src/renderer/harborIdentityTypes";
import type { TaskProjection } from "../../src/renderer/taskThreadFixtures";
import { runtime } from "./library-harness-fixtures";
import "../../src/renderer/uiFoundation.css";
import "../../src/renderer/styles.css";

type OwnerRequest = WebEnvoyOwnerApiJsonRequest;

const requests: OwnerRequest[] = [];
let facts = [identityFact("identity-env_aaaaaaaaaaaaaaaaaaaaaaaa", "品牌运营号", "xiaohongshu"), identityFact("identity-env_bbbbbbbbbbbbbbbbbbbbbbbb", "招聘观察号", "boss")];
let nextFailure: IdentityEnvironmentMutationFailureCode | null = null;
let offline = false;
let identityOffline = false;
let unknownMutationResult = false;

installOwnerMock();

function Harness() {
  const [generation, setGeneration] = useState(0);
  const initialState: HarborIdentityLoadState = { status: "ready", fetchedAt: "2026-07-22T00:00:00Z", summary: "ready", identities: [], providers: providerCatalog().providers };
  return <main className="identity-harness"><header className="shell-topbar production-topbar"><div className="topbar-center-surface"><h2>账号身份</h2><div id="identity-topbar-actions" className="prototype-center-actions" /></div></header><button hidden data-test-offline type="button" onClick={() => { offline = true; }}>offline</button><button hidden data-test-identity-offline type="button" onClick={() => { identityOffline = true; }}>identity-offline</button><button hidden data-test-empty type="button" onClick={() => { offline = false; identityOffline = false; facts = []; setGeneration((value) => value + 1); }}>empty</button><IdentityEnvironmentsPage key={generation} harborEndpoint="http://127.0.0.1:8790" initialState={initialState} runtimeSupervisorState={runtime} tasks={tasks} onHarborStateChange={() => {}} onOpenLibrary={() => {}} onOpenSettings={() => {}} /></main>;
}

createRoot(document.getElementById("root")!).render(<Harness />);

window.__runIdentityDomSmoke = async (mode) => {
  await waitUntil(() => document.querySelectorAll(".identity-catalog-row").length === 2, "identity catalog");
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
  fillInput("accountIdentifier", "新建运营号");
  document.querySelector<HTMLButtonElement>(".identity-editor-actions .primary")?.click();
  await waitUntil(() => document.body.textContent?.includes("账号身份已创建") === true, "identity create");
  document.querySelector<HTMLButtonElement>(".identity-back-link")?.click();
  await waitUntil(() => document.querySelector(".identity-catalog-header") != null, "catalog after create");
  clickButton("导入");
  await waitUntil(() => document.querySelector(".identity-editor") != null, "import identity form");
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
    const input = body.identity_environment as { site?: { account_identifier?: string; site_id?: string } };
    facts = [...facts, identityFact(targetRef, input.site?.account_identifier ?? "新账号", input.site?.site_id === "boss" ? "boss" : "xiaohongshu")];
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

function identityFact(ref: string, account: string, siteId: "xiaohongshu" | "boss") {
  const boss = siteId === "boss";
  return { schema_version: "harbor-local-identity-environment/v0", identity_environment_ref: ref, execution_identity_ref: `${ref}:execution`, profile_ref: `${ref}:profile`, site_binding: { site_id: siteId, origin: boss ? "https://www.zhipin.com" : "https://www.xiaohongshu.com", display_name: boss ? "BOSS" : "小红书", account_label: account }, login_state: { state: "logged_in", reason: null, recovery_required: false, manual_authentication_state: "not_required", human_verification: [] }, browser_storage: { profile_storage_ref: `${ref}:storage`, state: "present", cookies_session_state: "present" }, environment: { proxy: { state: "configured", proxy_ref: "proxy_ref_public", label: "团队推荐线路" }, region: "CN-SH", geoip_mode: "proxy", language: "zh-CN", timezone: "Asia/Shanghai", browser_family: "cloakbrowser", user_agent_summary: "Chrome family", viewport: "1440x900", hardware_concurrency: 8, device_memory_gb: 8, gpu_profile: "desktop-default", interaction_preset: "default", fingerprint_strategy: "provider_default", fingerprint_summary: "provider default" }, provider_binding: { selected_provider_id: "cloakbrowser", selection_reason: "configured", requires_user_notice: false, selected_provider: providerCatalog().providers[0], warnings: [], unavailable_reason: null }, credential_recovery: { credential_ref: null, recovery_actions: [] }, diagnostics: [] };
}

function providerCatalog() { return { schema_version: "harbor-browser-provider-status/v0", providers: [{ provider_id: "cloakbrowser", display_name: "CloakBrowser", role: "primary", install: { status: "installed", path: null, version: "test", launchability: "launchable", reason: null }, capabilities: [{ key: "proxy", state: "supported", source: "runtime_verification" }, { key: "locale", state: "supported", source: "runtime_verification" }, { key: "timezone", state: "supported", source: "runtime_verification" }, { key: "viewport", state: "supported", source: "runtime_verification" }] }, { provider_id: "chrome_official", display_name: "官方 Chrome", role: "restricted_fallback", install: { status: "installed", path: null, version: "test", launchability: "launchable", reason: null }, capabilities: [] }], excluded_providers: [] } as const; }
function runtimeSession(controlOwner: "user" | "none" = "user") { return { schema_version: "harbor-runtime-facts/v0", runtime_session_ref: "session_public", provider_ref: "provider_public", lifecycle_state: "active", created_at: "2026-07-22T00:00:00Z", last_seen_at: "2026-07-22T00:00:01Z", current_page: { requested_url: "https://www.xiaohongshu.com", current_url: "https://www.xiaohongshu.com", title: "小红书", status: "ready" }, control_owner: controlOwner, control_lock: { owner: controlOwner, state: controlOwner === "user" ? "held" : "released" }, current_error: null }; }

const tasks = [{ id: "task-a", title: "A", accountIdentity: "A", siteSkill: "A", businessInput: "", source: "Core live", packageSource: { name: "A", version: "1", capabilityRef: "A", sourceRef: "A", fetchedAt: "", source: "Core live", boundary: "" }, runs: [], updatedAt: "2026-07-20T00:00:00Z", threadContext: { siteLabel: "小红书", siteSkillKey: "A", accountIdentityKey: "identity-env_aaaaaaaaaaaaaaaaaaaaaaaa" } }, { id: "task-b", title: "B", accountIdentity: "B", siteSkill: "B", businessInput: "", source: "Core live", packageSource: { name: "B", version: "1", capabilityRef: "B", sourceRef: "B", fetchedAt: "", source: "Core live", boundary: "" }, runs: [], updatedAt: "2026-07-22T00:00:00Z", threadContext: { siteLabel: "BOSS", siteSkillKey: "B", accountIdentityKey: "identity-env_bbbbbbbbbbbbbbbbbbbbbbbb" } }] satisfies TaskProjection[];

function setInput(element: Element | null, value: string) { const input = element as HTMLInputElement; const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set; setter?.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); }
function fillInput(name: string, value: string) { fillInputIn(document.querySelector(`[name='${name}']`), value); }
function fillInputIn(element: Element | null, value: string) { if (!element) throw new Error("Missing input."); setInput(element, value); }
function findButton(text: string) { const button = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((item) => item.textContent?.trim().includes(text)); if (!button) throw new Error(`Missing button: ${text}`); return button; }
function clickButton(text: string) { findButton(text).click(); }
function setSelect(label: string, value: string) { const select = document.querySelector<HTMLSelectElement>(`[aria-label='${label}']`) ?? Array.from(document.querySelectorAll("label")).find((item) => item.textContent?.startsWith(label))?.querySelector("select"); if (!select) throw new Error(`Missing select: ${label}`); select.value = value; select.dispatchEvent(new Event("change", { bubbles: true })); }
function nextFrame() { return new Promise<void>((resolve) => requestAnimationFrame(() => resolve())); }
async function twoFrames() { await nextFrame(); await nextFrame(); }
async function waitUntil(predicate: () => boolean, label: string) { for (let attempt = 0; attempt < 120; attempt += 1) { if (predicate()) return; await nextFrame(); } const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>(".identity-catalog-header button, .identity-empty button")).map((button) => `${button.textContent}:${button.disabled}`); throw new Error(`Timed out waiting for ${label}: ${document.body.textContent?.slice(-500)} buttons=${buttons.join("|")}.`); }
function assertNoOverflow(label: string) { const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth; if (overflow > 1) throw new Error(`${label} overflowed by ${overflow}px.`); }

declare global { interface Window { __runIdentityDomSmoke: (mode: "desktop" | "narrow") => Promise<unknown>; } }
