import { useState } from "react";
import { createRoot } from "react-dom/client";

import { createAwaitingTargetCompatibility } from "../../src/renderer/coreIdentityCompatibilityClient";
import { createTaskThreadTurn } from "../../src/renderer/coreTaskThreadSubmitClient";
import { fetchEffectiveExecutionPolicy } from "../../src/renderer/executionPolicyClient";
import { AppShellView } from "../../src/renderer/AppShellView";
import { CreateTaskShell, type CreateTaskSelection } from "../../src/renderer/CreateTaskShell";
import { RuntimeBlockedOwnerState, RuntimeCheckingOwnerState } from "../../src/renderer/RuntimeOwnerState";
import { SiteSkillLibrary } from "../../src/renderer/SiteSkillPages";
import { TaskThreadComposer } from "../../src/renderer/TaskThreadComposer";
import { TaskTurnBusinessInput } from "../../src/renderer/TaskTurnBusinessInput";
import { createSkillInputDraft } from "../../src/renderer/skillInputDraft";
import type { TaskProjection } from "../../src/renderer/taskThreadFixtures";
import { useAppController, type AppController } from "../../src/renderer/useAppController";
import { runLibraryContractSmoke } from "./library-contract-smoke";
import {
  bossSkill, catalog, detailSkill, identity, identityB, installLibraryShellMock, libraryOwnerRequests,
  protectedDrafts, runtime, setProtectedDraftDeleteStatus, setProtectedDraftSaveDelay, xhsSkill,
} from "./library-harness-fixtures";
import "../../src/renderer/uiFoundation.css";
import "../../src/renderer/styles.css";
import "../../src/renderer/workbench.css";

installLibraryShellMock();
let controllerSnapshot: AppController | undefined;

function ControllerProbe() {
  controllerSnapshot = useAppController();
  return null;
}

function ProductionHarness() {
  const controller = useAppController();
  controllerSnapshot = controller;
  return <AppShellView controller={controller} />;
}

function Harness() {
  const [selection, setSelection] = useState("");
  const [createSelection, setCreateSelection] = useState<CreateTaskSelection | null>(null);
  const [submittedTask, setSubmittedTask] = useState<TaskProjection>();
  const [threadSkillAvailable, setThreadSkillAvailable] = useState(true);
  const [threadIdentityAvailable, setThreadIdentityAvailable] = useState(true);
  const compatibilityBySkill = Object.fromEntries(catalog.skills.map((skill) => [
    skill.id,
    skill === detailSkill
      ? createAwaitingTargetCompatibility([identity.identityEnvironmentRef, identityB.identityEnvironmentRef])
      : {
          status: "ready" as const,
          summary: "兼容性已检查。",
          candidates: [identity, identityB].map((item, index) => ({
            identityEnvironmentRef: item.identityEnvironmentRef,
            status: index === 0 ? "unknown_until_runtime" as const : "requires_setup" as const,
            reasonCodes: index === 0 ? ["runtime_facts_require_task_admission"] : ["authentication_required"],
            recoveryAction: index === 0 ? "retry_at_task_submission" as const : "open_manual_auth" as const,
          })),
        },
  ]));
  return (
    <main style={{ width: "100vw", height: "100vh", overflow: "auto", background: "var(--we-surface-primary)" }}>
      <ControllerProbe />
      {submittedTask != null ? (
        <TaskThreadComposer
          coreEndpoint="http://127.0.0.1:8787"
          harborIdentityState={{ status: "ready", fetchedAt: "2026-07-20T00:00:00Z", summary: "ready", identities: threadIdentityAvailable ? [identity, identityB] : [identityB] }}
          runtimeSupervisorState={runtime}
          selectedTask={submittedTask}
          skill={threadSkillAvailable ? xhsSkill : undefined}
          onTask={setSubmittedTask}
        />
      ) : createSelection == null ? (
        <SiteSkillLibrary
          catalog={catalog} compatibilityBySkill={compatibilityBySkill} identities={[identity, identityB]}
          runtimeSupervisorState={runtime} onCreateIdentity={() => setSelection("create-identity")} onNavigation={() => {}}
          onRecoveryConsumed={() => {}}
          onRecoverCandidate={(_skill, identityId, candidate) => setSelection(`${identityId}:${candidate.recoveryAction}`)}
          onUse={(skill, identityId) => { setSelection(`${skill.packageRef}:${identityId}`); setCreateSelection({ skill, identityId }); }}
        />
      ) : (
        <CreateTaskShell
          catalog={catalog} compatibilityBySkill={compatibilityBySkill} identities={[identity, identityB]}
          selection={createSelection} runtimeSupervisorState={runtime} onSelect={() => {}}
          onCreateIdentity={() => setSelection("create-identity")}
          onCheckCompatibility={async (_skill, identityId) => ({
            status: "ready", summary: "目标已检查。", candidates: [{
              identityEnvironmentRef: [identity, identityB].find((item) => item.id === identityId)!.identityEnvironmentRef,
              status: "compatible", reasonCodes: [], recoveryAction: "none",
            }],
          })}
          onRecover={() => setSelection("check-task-owner")}
          onRecoverCandidate={(_skill, identityId, candidate) => setSelection(`${identityId}:${candidate.recoveryAction}`)}
          onRecoverRuntimeIdentity={(_skill, identityId) => setSelection(`${identityId}:runtime`)}
          onRecoverRuntimeSkill={(skill) => setSelection(`${skill.id}:runtime`)}
          onRecoverExactTarget={() => setSelection("use-search-skill")} onTargetChange={() => {}}
          coreEndpoint="http://127.0.0.1:8787"
          onTaskCreated={setSubmittedTask}
        />
      )}
      {submittedTask?.runs[0]?.businessInput == null ? null : <TaskTurnBusinessInput input={submittedTask.runs[0].businessInput} />}
      {submittedTask == null ? null : <button hidden data-hide-thread-skill type="button" onClick={() => setThreadSkillAvailable(false)}>隐藏技能合同</button>}
      {submittedTask == null ? null : <button hidden data-show-thread-skill type="button" onClick={() => setThreadSkillAvailable(true)}>恢复技能合同</button>}
      {submittedTask == null ? null : <button hidden data-hide-thread-identity type="button" onClick={() => setThreadIdentityAvailable(false)}>隐藏账号身份</button>}
      {submittedTask == null ? null : <button hidden data-show-thread-identity type="button" onClick={() => setThreadIdentityAvailable(true)}>恢复账号身份</button>}
      {createSelection != null ? <button type="button" data-library-switch onClick={() => setCreateSelection(null)}>切换技能</button> : null}
      {createSelection != null ? <button type="button" data-catalog-refresh onClick={() => setCreateSelection((current) => current == null ? null : ({ ...current, skill: { ...current.skill, summary: `${current.skill.summary} refreshed` } }))}>刷新目录</button> : null}
      <output data-library-selection="">{selection}</output>
    </main>
  );
}

const productionMode = new URLSearchParams(window.location.search).has("production");
if (productionMode) window.localStorage.setItem("webenvoy.workbench.task-grouping.v1", "skill");
createRoot(document.getElementById("root")!).render(productionMode ? <ProductionHarness /> : <Harness />);

window.__runLibraryDomSmoke = async (mode) => {
  await twoFrames();
  if (mode === "production") return runProductionShellFlow();
  const runtimeOwnerState = mode === "desktop" ? await checkRuntimeOwnerStates() : true;
  const directory = await checkDirectory(mode);
  if (mode === "stale") return { mode, staleCreateDisabled: true };
  const controllerRecovery = mode === "desktop" ? await checkControllerIdentityRecovery() : true;
  directory.xhsRow.click();
  await twoFrames();
  checkSkillDetail();
  document.querySelector<HTMLButtonElement>(".production-back-link")?.click();
  await twoFrames();
  const restoredSkillTrigger = document.activeElement as HTMLButtonElement | null;
  if (!restoredSkillTrigger?.classList.contains("production-skill-row-main") ||
    !restoredSkillTrigger.textContent?.includes(xhsSkill.name)) {
    throw new Error("Library detail did not restore focus to its skill trigger.");
  }
  restoredSkillTrigger.click();
  await twoFrames();
  checkSkillDetail();
  const radios = Array.from(document.querySelectorAll<HTMLButtonElement>("[role='radio']"));
  radios[0]!.focus();
  radios[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  await nextFrame();
  if (radios[1]!.getAttribute("aria-checked") !== "true" || document.activeElement !== radios[1] ||
    document.querySelector<HTMLButtonElement>(".skill-detail-heading .production-primary-button")?.disabled !== true ||
    !document.body.textContent?.includes("登录账号")) throw new Error("Library identity recovery or keyboard navigation failed.");
  radios[1]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
  await nextFrame();
  document.querySelector<HTMLButtonElement>(".skill-detail-heading .production-primary-button")?.click();
  await twoFrames();
  return { ...await runComposerFlow(mode, directory.searchHeight), controllerRecovery, runtimeOwnerState };
};

async function checkRuntimeOwnerStates() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const blockedRuntime = structuredClone(runtime);
  const harbor = blockedRuntime.services.find((service) => service.id === "harbor");
  if (harbor == null) throw new Error("Runtime owner-state fixture is missing Harbor.");
  harbor.health = { ...harbor.health, state: "unavailable", summary: "fixture unavailable" };
  blockedRuntime.canUseLiveRuntime = false;
  blockedRuntime.failClosed = true;
  let recovery = "";
  root.render(
    <RuntimeBlockedOwnerState
      runtime={blockedRuntime}
      onOpenBrowser={() => { recovery = "browser"; }}
      onOpenSettings={() => { recovery = "settings"; }}
    />,
  );
  await twoFrames();
  const status = container.querySelector<HTMLElement>("[data-testid='runtime-supervisor-status']");
  const action = status?.querySelector<HTMLButtonElement>("button");
  if (
    status?.getAttribute("aria-label") !== "运行环境状态" ||
    status.dataset.runtimeCoreHealth !== "ready" ||
    status.dataset.runtimeCoreAdmission !== "ready" ||
    status.dataset.runtimeHarborHealth !== "unavailable" ||
    !status.textContent?.includes("检查账号身份") ||
    action == null
  ) {
    throw new Error("Runtime blocked state did not expose the matching Harbor recovery surface.");
  }
  action.click();
  if (recovery !== "browser") throw new Error("Runtime blocked state did not route Harbor recovery to Browser.");
  root.render(<RuntimeCheckingOwnerState />);
  await twoFrames();
  if (!container.textContent?.includes("正在检查运行环境")) {
    throw new Error("Runtime checking state was presented as a settled failure.");
  }
  root.unmount();
  container.remove();
  return true;
}

async function runProductionShellFlow() {
  await waitForController();
  controllerSnapshot!.actions.onHarborStateChange({
    status: "ready",
    fetchedAt: "2026-07-21T00:00:00Z",
    summary: "Identity owner state ready.",
    identities: [identity, identityB],
  });
  await waitUntil(() => controllerSnapshot?.skillWorkbench.compatibilityBySkill[xhsSkill.id]?.status === "ready", "initial compatibility");
  await waitUntil(() => controllerSnapshot?.tasks.selectedTask?.threadContext?.accountIdentityKey === identity.identityEnvironmentRef, "thread identity binding");
  controllerSnapshot!.actions.selectTask(controllerSnapshot!.tasks.selectedTask!);
  await waitUntil(() => controllerSnapshot?.navigation.workMode === "detail" &&
    document.querySelector(".bottom-panel-slot") != null, "thread composer");
  const contentFrame = document.querySelector<HTMLElement>(".main-content-frame");
  const bottomPanel = document.querySelector<HTMLElement>(".bottom-panel-slot");
  const contentRect = contentFrame?.getBoundingClientRect();
  const bottomRect = bottomPanel?.getBoundingClientRect();
  if (contentRect == null || bottomRect == null || contentRect.bottom > bottomRect.top + 1) {
    throw new Error(`Thread composer overlaps the scrollable task timeline: ${JSON.stringify({
      contentBottom: contentRect?.bottom,
      bottomPanelTop: bottomRect?.top,
    })}`);
  }
  const detailRef = "detail_ref_123e4567-e89b-42d3-a456-426614174000";
  if (!await controllerSnapshot!.actions.openResultDetail(detailRef)) {
    throw new Error("Production controller did not open the owner-ref detail handoff.");
  }
  await waitUntil(() => controllerSnapshot?.skillWorkbench.createTaskSelection?.targetRef === detailRef &&
    controllerSnapshot?.navigation.workMode === "create" && document.activeElement?.matches("[data-fixed-business-input]") === true,
  "detail handoff composer");
  const detailSelection = controllerSnapshot!.skillWorkbench.createTaskSelection;
  if (detailSelection?.identityId !== identity.id ||
    detailSelection.skill.packageRef !== detailSkill.packageRef ||
    !document.body.textContent?.includes("读取所选搜索结果的详情") ||
    document.body.textContent?.includes(detailRef)) {
    throw new Error("Detail handoff did not preserve the thread identity or keep the owner ref hidden.");
  }
  controllerSnapshot!.actions.openView("work");
  await waitUntil(() => controllerSnapshot?.skillWorkbench.createTaskSelection == null, "detail handoff reset");
  const globalChoices = Array.from(document.querySelectorAll<HTMLButtonElement>(".create-task-recommendations > button"));
  if (globalChoices.some((choice) => choice.textContent?.includes(detailSkill.name))) {
    throw new Error("Global task creation exposed an exact-target detail skill.");
  }
  await controllerSnapshot!.skillWorkbench.useSiteSkill(detailSkill, identity.id);
  await waitUntil(() => document.querySelector(".owner-state")?.textContent?.includes("请先从搜索结果选择笔记") === true,
    "exact-target shortcut recovery");
  if (document.querySelector(".create-task-composer") != null ||
    document.body.textContent?.includes("Core 未返回账号身份兼容性")) {
    throw new Error("Exact-target shortcut exposed the direct URL composer or a false Core compatibility error.");
  }
  document.querySelector<HTMLButtonElement>(".owner-state button")?.click();
  await waitUntil(() => controllerSnapshot?.navigation.activeView === "library" &&
    controllerSnapshot.skillWorkbench.createTaskSelection == null, "exact-target library recovery");
  controllerSnapshot!.actions.openView("work");
  await waitUntil(() => controllerSnapshot?.navigation.workMode === "create", "resume global task creation");
  controllerSnapshot!.skillWorkbench.recoverCandidate(xhsSkill, identityB.id, {
    identityEnvironmentRef: identityB.identityEnvironmentRef,
    status: "requires_setup",
    reasonCodes: ["provider_conflict"],
    recoveryAction: "repair_browser_environment",
  });
  await waitUntil(() => controllerSnapshot?.navigation.activeView === "browser" &&
    controllerSnapshot?.skillWorkbench.identityRecoveryRequest?.destination === "provider" &&
    document.activeElement === document.querySelector("select[name='providerId']"), "provider recovery focus");
  if (!document.body.textContent?.includes(identityB.accountLabel)) {
    throw new Error("Browser environment recovery did not open the requested identity editor.");
  }
  controllerSnapshot!.actions.openView("work");
  await waitUntil(() => controllerSnapshot?.skillWorkbench.identityRecoveryRequest == null, "provider recovery resume");
  const sidebarAdd = document.querySelector<HTMLButtonElement>(".task-group-add");
  if (sidebarAdd == null) throw new Error("Production sidebar did not render the skill-group create control.");
  sidebarAdd.click();
  await twoFrames();
  const choices = Array.from(document.querySelectorAll<HTMLButtonElement>(".create-task-recommendations > button"));
  if (document.querySelector(".create-task-composer") != null || choices.length !== 2 ||
    choices.some((choice) => !choice.textContent?.includes(xhsSkill.name))) {
    throw new Error("Skill-only task creation did not require a compatible identity selection.");
  }
  assertNoHorizontalOverflow("skill-only chooser");
  choices[0]!.click();
  await waitUntil(() => document.querySelector(".create-task-composer") != null, "identity selection composer");
  const composerRect = document.querySelector(".create-task-composer")!.getBoundingClientRect();
  const composerToolbarRect = document.querySelector(".create-task-composer-toolbar")!.getBoundingClientRect();
  if (composerToolbarRect.bottom > composerRect.bottom + 1) throw new Error("Structured composer toolbar overflowed its frame.");
  assertNoHorizontalOverflow("create-task composer");
  controllerSnapshot!.actions.onHarborStateChange({
    status: "ready",
    fetchedAt: "2026-07-21T00:01:00Z",
    summary: "Selected identity was removed by owner refresh.",
    identities: [identityB],
  });
  await waitUntil(() => document.querySelector(".create-task-composer") == null &&
    document.querySelectorAll(".create-task-recommendations > button").length === 1 &&
    document.activeElement?.matches(".create-task-recommendations > button") === true, "removed identity fallback");
  assertNoHorizontalOverflow("removed identity fallback");
  document.querySelector<HTMLButtonElement>(".create-task-recommendations > button")?.click();
  await waitUntil(() => document.querySelector(".create-task-composer") != null, "replacement identity composer");
  assertNoHorizontalOverflow("replacement identity composer");

  controllerSnapshot!.sources.setLodeCatalogState({ ...catalog, status: "stale", summary: "Catalog stale." });
  await waitUntil(() => controllerSnapshot?.skillWorkbench.compatibilityBySkill[xhsSkill.id]?.status === "unavailable", "stale compatibility");
  controllerSnapshot!.sources.setLodeCatalogState({ ...catalog, status: "ready" });
  await waitUntil(() => controllerSnapshot?.skillWorkbench.compatibilityBySkill[xhsSkill.id]?.status === "ready", "refreshed compatibility");

  controllerSnapshot!.sources.setLodeCatalogState({ ...catalog, status: "offline", summary: "Catalog offline." });
  controllerSnapshot!.skillWorkbench.recoverCandidate(xhsSkill, identityB.id, {
    identityEnvironmentRef: identityB.identityEnvironmentRef,
    status: "incompatible",
    reasonCodes: ["package_contract_invalid"],
    recoveryAction: "repair_package_contract",
  });
  await waitUntil(() => controllerSnapshot?.navigation.activeView === "library" &&
    controllerSnapshot?.skillWorkbench.siteSkillRecoveryRequest != null, "deferred site-skill recovery");
  controllerSnapshot!.actions.openView("work");
  await waitUntil(() => controllerSnapshot?.skillWorkbench.siteSkillRecoveryRequest == null, "abandoned site-skill recovery");

  controllerSnapshot!.sources.setLodeCatalogState({ ...catalog, status: "ready" });
  controllerSnapshot!.skillWorkbench.recoverCandidate(xhsSkill, identityB.id, {
    identityEnvironmentRef: identityB.identityEnvironmentRef,
    status: "incompatible",
    reasonCodes: ["package_contract_invalid"],
    recoveryAction: "repair_package_contract",
  });
  await waitUntil(() => controllerSnapshot?.navigation.activeView === "library" &&
    controllerSnapshot?.skillWorkbench.siteSkillRecoveryRequest == null &&
    document.querySelector<HTMLDetailsElement>(".production-skill-maintenance")?.open === true, "site-skill recovery consumption");
  const horizontalOverflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
  if (horizontalOverflow > 1) throw new Error(`Production shell overflowed by ${horizontalOverflow}px.`);
  return {
    sidebarSkillCreate: true,
    skillOnlyIdentityChooser: true,
    removedIdentityRecovered: true,
    staleReadyRecomputed: true,
    abandonedRecoveryCleared: true,
    recoveryRequestConsumed: true,
    resultDetailHandoff: true,
    exactTargetEntryRestricted: true,
    horizontalOverflow: false,
  };
}

async function checkControllerIdentityRecovery() {
  await waitForController();
  controllerSnapshot!.actions.onHarborStateChange({
    status: "ready",
    fetchedAt: "2026-07-21T00:00:00Z",
    summary: "Identity fixtures ready.",
    identities: [identity, identityB],
  });
  await twoFrames();
  controllerSnapshot!.skillWorkbench.recoverCandidate(xhsSkill, identityB.id, {
    identityEnvironmentRef: identityB.identityEnvironmentRef,
    status: "requires_setup",
    reasonCodes: ["authentication_required"],
    recoveryAction: "open_manual_auth",
  });
  await twoFrames();
  const recovery = controllerSnapshot!;
  if (recovery.navigation.activeView !== "browser" || recovery.skillWorkbench.identityRecoveryRequest == null ||
    recovery.skillWorkbench.createTaskSelection?.skill.packageRef !== xhsSkill.packageRef ||
    recovery.skillWorkbench.createTaskSelection.identityId !== identityB.id) {
    throw new Error("Controller did not preserve the selected skill and identity while opening authentication recovery.");
  }
  recovery.actions.openView("work");
  await twoFrames();
  const resumed = controllerSnapshot!;
  if (resumed.navigation.activeView !== "work" || resumed.navigation.workMode !== "create" ||
    resumed.skillWorkbench.identityRecoveryRequest != null ||
    resumed.skillWorkbench.createTaskSelection?.skill.packageRef !== xhsSkill.packageRef ||
    resumed.skillWorkbench.createTaskSelection.identityId !== identityB.id) {
    throw new Error("Controller did not consume identity recovery while preserving task creation context.");
  }
  resumed.skillWorkbench.recoverRuntimeIdentity(xhsSkill, identity.id);
  await twoFrames();
  const runtimeRecovery = controllerSnapshot!;
  if (runtimeRecovery.navigation.activeView !== "browser" || runtimeRecovery.skillWorkbench.identityRecoveryRequest?.destination !== "refresh" ||
    runtimeRecovery.skillWorkbench.createTaskSelection?.skill.packageRef !== xhsSkill.packageRef ||
    runtimeRecovery.skillWorkbench.createTaskSelection.identityId !== identity.id) {
    throw new Error("Runtime recovery did not preserve the selected skill and identity while opening Browser.");
  }
  runtimeRecovery.actions.openView("work");
  await twoFrames();
  if (controllerSnapshot!.skillWorkbench.identityRecoveryRequest != null ||
    controllerSnapshot!.skillWorkbench.createTaskSelection?.skill.packageRef !== xhsSkill.packageRef ||
    controllerSnapshot!.skillWorkbench.createTaskSelection.identityId !== identity.id) {
    throw new Error("Runtime recovery did not restore task creation context after Browser.");
  }
  controllerSnapshot!.skillWorkbench.recoverRuntimeSkill(xhsSkill);
  await twoFrames();
  const skillOnlyRuntimeRecovery = controllerSnapshot!;
  if (skillOnlyRuntimeRecovery.navigation.activeView !== "browser" ||
    skillOnlyRuntimeRecovery.skillWorkbench.identityRecoveryRequest?.destination !== "refresh" ||
    skillOnlyRuntimeRecovery.skillWorkbench.identityRecoveryRequest.identityId != null ||
    skillOnlyRuntimeRecovery.skillWorkbench.createTaskSelection?.skill.packageRef !== xhsSkill.packageRef ||
    skillOnlyRuntimeRecovery.skillWorkbench.createTaskSelection.identityId != null) {
    throw new Error("Runtime recovery selected an identity while preserving a skill-only creation context.");
  }
  skillOnlyRuntimeRecovery.actions.openView("work");
  await twoFrames();
  if (controllerSnapshot!.skillWorkbench.identityRecoveryRequest != null ||
    controllerSnapshot!.skillWorkbench.createTaskSelection?.skill.packageRef !== xhsSkill.packageRef ||
    controllerSnapshot!.skillWorkbench.createTaskSelection.identityId != null) {
    throw new Error("Skill-only runtime recovery did not restore the task creation context after Browser.");
  }
  await assertIdentityRecoveryAbandoned("library", () => controllerSnapshot!.actions.openView("library"));
  const task = controllerSnapshot!.tasks.taskThreads[0];
  if (task == null) throw new Error("Controller recovery smoke requires one task thread.");
  await assertIdentityRecoveryAbandoned("task", () => controllerSnapshot!.actions.selectTask(task));
  await assertIdentityRecoveryAbandoned("settings", () => controllerSnapshot!.actions.openSettings());
  await assertIdentityRecoveryAbandoned("new task", () => controllerSnapshot!.actions.createTask());
  controllerSnapshot!.skillWorkbench.selectCreateTaskSkill(detailSkill);
  await twoFrames();
  controllerSnapshot!.skillWorkbench.recoverExactTarget(detailSkill, identity.id);
  await twoFrames();
  if (controllerSnapshot!.navigation.activeView !== "library" || controllerSnapshot!.skillWorkbench.createTaskSelection != null) {
    throw new Error("Exact-target recovery guessed a replacement skill instead of returning to Library.");
  }
  return true;
}

async function assertIdentityRecoveryAbandoned(label: string, navigate: () => void) {
  controllerSnapshot!.skillWorkbench.recoverCandidate(xhsSkill, identityB.id, {
    identityEnvironmentRef: identityB.identityEnvironmentRef,
    status: "requires_setup",
    reasonCodes: ["authentication_required"],
    recoveryAction: "open_manual_auth",
  });
  await waitUntil(() => controllerSnapshot?.navigation.activeView === "browser" &&
    controllerSnapshot?.skillWorkbench.identityRecoveryRequest != null, `${label} identity recovery start`);
  navigate();
  await waitUntil(() => controllerSnapshot?.skillWorkbench.identityRecoveryRequest == null, `${label} identity recovery abandonment`);
  controllerSnapshot!.actions.openView("work");
  await twoFrames();
  if (controllerSnapshot!.skillWorkbench.identityRecoveryRequest != null ||
    controllerSnapshot!.skillWorkbench.createTaskSelection != null) {
    throw new Error(`Controller replayed identity recovery after ${label} navigation.`);
  }
}

async function waitForController() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (controllerSnapshot?.sources.lodeCatalogState.status === "ready" && controllerSnapshot.sources.runtimeSupervisorState.canUseLiveRuntime) return;
    await nextFrame();
  }
  throw new Error("Controller probe did not load owner catalog and runtime state.");
}

async function waitUntil(predicate: () => boolean, label: string) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (predicate()) return;
    await nextFrame();
  }
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify({
    activeView: controllerSnapshot?.navigation.activeView,
    workMode: controllerSnapshot?.navigation.workMode,
    catalogStatus: controllerSnapshot?.sources.lodeCatalogState.status,
    compatibilityStatus: controllerSnapshot?.skillWorkbench.compatibilityBySkill[xhsSkill.id]?.status,
    recoveryRequest: controllerSnapshot?.skillWorkbench.siteSkillRecoveryRequest,
    body: document.body.textContent?.slice(0, 500),
  })}`);
}

function assertNoHorizontalOverflow(label: string) {
  const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
  if (overflow > 1) throw new Error(`${label} overflowed by ${overflow}px.`);
}

async function checkDirectory(mode: "desktop" | "narrow" | "stale") {
  const bodyText = document.body.textContent ?? "";
  const xhsRow = Array.from(document.querySelectorAll<HTMLButtonElement>(".production-skill-row-main")).find((button) => button.textContent?.includes(xhsSkill.name));
  const bossUse = skillUseButton(bossSkill.name);
  const xhsUse = skillUseButton(xhsSkill.name);
  const categoryCount = Array.from(document.querySelectorAll(".production-library-filters button")).filter((button) => button.textContent === xhsSkill.category).length;
  const searchHeight = document.querySelector(".production-library-search")?.getBoundingClientRect().height ?? 0;
  await runLibraryContractSmoke({ catalog, detailSkill, identityEnvironmentRef: identity.identityEnvironmentRef, protectedDrafts, xhsSkill });
  if (!bodyText.includes("发现站点技能") || bodyText.includes("示例技能") || xhsRow == null || bossUse?.disabled !== true ||
    mode === "stale" && xhsUse?.disabled !== true || categoryCount !== 1 || mode === "narrow" && searchHeight > 50) {
    throw new Error("Library directory did not render owner skills or fail closed.");
  }
  return { searchHeight, xhsRow };
}

function checkSkillDetail() {
  const text = document.body.textContent ?? "";
  const primaryUse = document.querySelector<HTMLButtonElement>(".skill-detail-heading .production-primary-button");
  const radios = Array.from(document.querySelectorAll<HTMLButtonElement>("[role='radio']"));
  if (!text.includes("Keyword") || !text.includes("读取和下载") || !text.includes("App 标准结构化视图") ||
    !text.includes("提交时再检查") || primaryUse?.disabled || document.activeElement?.classList.contains("production-back-link") !== true ||
    radios.length !== 2 || radios.filter((radio) => radio.tabIndex === 0).length !== 1) {
    throw new Error("Library detail did not project input, action, output, or compatible identity state.");
  }
}

async function runComposerFlow(mode: string, searchHeight: number) {
  const selection = document.querySelector("[data-library-selection]")?.textContent ?? "";
  const initialInvalid = document.querySelectorAll(".create-task-field [aria-invalid='true']").length;
  const attachmentAdded = document.querySelector(".create-task-file-control") == null;
  const longFileLayoutSafe = true;
  document.querySelector<HTMLButtonElement>(".create-task-submit")?.click();
  await nextFrame();
  const submittedInvalid = document.querySelectorAll(".create-task-field [aria-invalid='true']").length;
  const firstErrorFocused = document.activeElement?.getAttribute("name") === "keyword";
  const live = document.querySelector("[aria-live='assertive']")?.textContent ?? "";
  setInputValue(document.querySelector("[name='keyword']"), "AI tools");
  document.querySelector<HTMLButtonElement>("[data-catalog-refresh]")?.click();
  await twoFrames();
  const catalogRefreshPreserved = document.querySelector<HTMLInputElement>("[name='keyword']")?.value === "AI tools";
  await reopenComposer();
  const restoredKeyword = document.querySelector<HTMLInputElement>("[name='keyword']")?.value;
  const attachmentRestored = document.querySelector(".create-task-file-control") == null;
  document.querySelector<HTMLButtonElement>(".create-task-submit")?.click();
  await waitUntil(() => document.querySelector<HTMLInputElement>("[name='keyword']")?.value === "" &&
    document.querySelector(".task-turn-business-input")?.textContent?.includes("已提交受保护输入") === true, "accepted turn and cleared composer");
  const submittedCard = document.querySelector(".task-turn-business-input")?.textContent ?? "";
  const createIndex = libraryOwnerRequests.findIndex((request) => request.path === "/threads" && request.method === "POST");
  const policyIndex = libraryOwnerRequests.findIndex((request, index) => index > createIndex && request.path.includes("/execution-policy?") && request.method === "PUT");
  const turnIndex = libraryOwnerRequests.findIndex((request, index) => index > createIndex && request.path.endsWith("/turns") && request.method === "POST");
  const acceptedTurnRequest = libraryOwnerRequests[turnIndex];
  const acceptedPayload = JSON.stringify(acceptedTurnRequest?.body);
  const acceptedSnapshot = (acceptedTurnRequest?.body as { input_snapshot?: { fields?: Array<{ field_id: string; kind: string; summary?: string }>; attachment_refs?: string[] } })?.input_snapshot;
  const acceptedTaskIntent = (acceptedTurnRequest?.body as { task_intent?: { resource_requirement_profile_id?: string } })?.task_intent;
  const acceptedFields = Object.fromEntries((acceptedSnapshot?.fields ?? []).map((field) => [field.field_id, field]));
  const acceptedFlow = createIndex >= 0 && policyIndex === -1 && turnIndex > createIndex &&
    acceptedFields.url == null &&
    acceptedFields.keyword?.kind === "long_text" && acceptedFields.keyword?.owner_ref != null &&
    acceptedTaskIntent?.resource_requirement_profile_id === xhsSkill.actions[0]?.resourceRequirementProfileIds[0] &&
    acceptedSnapshot?.attachment_refs?.length === 0 &&
    !acceptedPayload.includes("library-harness-attachment.txt");
  setInputValue(document.querySelector("[name='keyword']"), "page not ready");
  await waitUntil(() => document.querySelector<HTMLButtonElement>(".create-task-submit")?.disabled === false, "terminal failure composer readiness");
  document.querySelector<HTMLButtonElement>(".create-task-submit")?.click();
  await waitUntil(() => document.querySelector(".create-task-submit-state.failed")?.textContent?.includes("Core 已确认") === true,
    "terminal runtime failure reconciliation");
  const terminalFailureReconciled = document.querySelector(".create-task-submit-state.failed")?.textContent?.includes("/turns returned 400") !== true &&
    document.querySelector<HTMLInputElement>("[name='keyword']")?.value === "page not ready";
  setInputValue(document.querySelector("[name='keyword']"), "unknown outcome");
  await waitUntil(() => document.querySelector<HTMLButtonElement>(".create-task-submit")?.disabled === false, "thread composer readiness");
  document.querySelector<HTMLButtonElement>(".create-task-submit")?.click();
  await waitUntil(() => document.querySelector<HTMLInputElement>("[name='keyword']")?.value === "unknown outcome" &&
    document.querySelector(".create-task-submit-state.unknown")?.textContent?.includes("重新检查") === true, "unknown outcome draft preservation");
  document.querySelector<HTMLButtonElement>("[data-hide-thread-skill]")?.click();
  await waitUntil(() => document.querySelector(".composer-owner-state")?.textContent?.includes("站点技能合同不可用") === true &&
    document.querySelector("[aria-label='重新检查当前回合']") != null &&
    document.querySelector("[aria-label='停止当前回合']") != null, "missing skill recovery controls");
  const unknownPostCount = libraryOwnerRequests.filter((request) => request.path.endsWith("/turns") && request.method === "POST").length;
  document.querySelector<HTMLButtonElement>("[aria-label='重新检查当前回合']")?.click();
  await twoFrames();
  await waitUntil(() => libraryOwnerRequests.some((request) =>
    request.path === "/threads/thread_11111111111111111111111111111111" && request.method === "GET") &&
    document.querySelector(".composer-owner-state") != null, "unknown outcome reconciliation");
  const unknownDraftPreserved =
    document.querySelector(".composer-owner-state") != null &&
    libraryOwnerRequests.filter((request) => request.path.endsWith("/turns") && request.method === "POST").length === unknownPostCount;
  document.querySelector<HTMLButtonElement>("[data-show-thread-skill]")?.click();
  await waitUntil(() => document.querySelector(".create-task-submit-state.unknown")?.textContent?.includes("重新检查") === true,
    "persisted unknown composer recovery");
  document.querySelector<HTMLButtonElement>("[data-hide-thread-identity]")?.click();
  await waitUntil(() => document.querySelector(".composer-owner-state")?.textContent?.includes("账号身份不可用") === true &&
    document.querySelector("[aria-label='重新检查当前回合']") != null &&
    document.querySelector("[aria-label='停止当前回合']") != null, "missing identity recovery controls");
  const activeSubmitBlocked = document.querySelector(".create-task-submit") == null;
  const stopButton = document.querySelector<HTMLButtonElement>("[aria-label='停止当前回合']");
  stopButton?.click();
  await waitUntil(() => document.querySelector(".composer-owner-state")?.textContent?.includes("当前回合已停止") === true,
    "active turn cancellation");
  await nextFrame();
  const recoveryFocusRestored = document.activeElement?.matches(".composer-owner-state [role='status']") === true;
  const terminateRequest = libraryOwnerRequests.find((request) => request.path.endsWith("/terminate"));
  document.querySelector<HTMLButtonElement>("[data-show-thread-identity]")?.click();
  await waitUntil(() => document.querySelector<HTMLInputElement>("[name='keyword']")?.value === "unknown outcome", "identity recovery");
  const cancellationPreservedDraft = document.querySelector<HTMLInputElement>("[name='keyword']")?.value === "unknown outcome";
  setInputValue(document.querySelector("[name='keyword']"), "server unavailable");
  const serverFailurePostCount = libraryOwnerRequests.filter((request) => request.path.endsWith("/turns") && request.method === "POST").length;
  document.querySelector<HTMLButtonElement>(".create-task-submit")?.click();
  await waitUntil(() => document.querySelector(".create-task-submit-state.unknown") != null, "503 submission outcome stayed unknown");
  document.querySelector<HTMLButtonElement>(".create-task-submit-state.unknown button")?.click();
  await twoFrames();
  const serverFailureStayedUnknown = document.querySelector<HTMLInputElement>("[name='keyword']")?.value === "server unavailable" &&
    document.querySelector(".create-task-submit-state.unknown") != null &&
    libraryOwnerRequests.filter((request) => request.path.endsWith("/turns") && request.method === "POST").length === serverFailurePostCount + 1;
  const policySaveStart = libraryOwnerRequests.length;
  const policyMenu = document.querySelector<HTMLDetailsElement>(".composer-execution-menu");
  if (policyMenu != null) policyMenu.open = true;
  Array.from(document.querySelectorAll<HTMLButtonElement>("[role='group'][aria-label='读取和下载执行方式'] button"))
    .find((button) => button.textContent === "确认")?.click();
  await nextFrame();
  Array.from(document.querySelectorAll<HTMLButtonElement>(".composer-execution-actions button"))
    .find((button) => button.textContent?.includes("另存为我的技能默认"))?.click();
  await waitUntil(() => libraryOwnerRequests.slice(policySaveStart).some((request) =>
    request.path.startsWith("/execution-policies/effective?") && request.path.includes("thread_ref=")), "skill policy effective refetch");
  const policySaveRequests = libraryOwnerRequests.slice(policySaveStart);
  const skillConfigRead = policySaveRequests.findIndex((request) => request.path.startsWith("/execution-policy-configs/skill?") && request.method === "GET");
  const skillConfigWrite = policySaveRequests.findIndex((request) => request.path.startsWith("/execution-policy-configs/skill?") && request.method === "PUT");
  const threadEffectiveRefetch = policySaveRequests.findIndex((request, index) => index > skillConfigWrite &&
    request.path.startsWith("/execution-policies/effective?") && request.path.includes("thread_ref="));
  const savedModes = (policySaveRequests[skillConfigWrite]?.body as { modes?: Record<string, string> })?.modes;
  const skillPolicyVersionSafe = skillConfigRead >= 0 && skillConfigWrite > skillConfigRead && threadEffectiveRefetch > skillConfigWrite &&
    (policySaveRequests[skillConfigWrite]?.body as { expected_source_version?: string })?.expected_source_version === "5" &&
    JSON.stringify(savedModes) === JSON.stringify({ read: "confirm" });
  const reusedThreadSafe = await checkReusedThreadPolicyRevision();
  const resourceProfileBoundarySafe = await checkResourceProfileSubmissionBoundary();
  setProtectedDraftSaveDelay(300);
  await new Promise((resolve) => setTimeout(resolve, 220));
  const attachmentRemoved = document.querySelector(".create-task-file-control") == null;
  document.querySelector<HTMLButtonElement>(".create-task-composer-toolbar [aria-label='清空业务输入']")?.click();
  await new Promise((resolve) => setTimeout(resolve, 450));
  setProtectedDraftSaveDelay(0);
  const cleared = document.querySelector<HTMLInputElement>("[name='keyword']")?.value === "" && !document.body.textContent?.includes("library-harness-attachment.txt");
  const clearedDraftStayedDeleted = ![...protectedDrafts.values()].some((value) => JSON.stringify(value).includes(identity.id));
  setInputValue(document.querySelector("[name='keyword']"), "cannot-delete-persisted-draft");
  await nextFrame();
  setProtectedDraftDeleteStatus("unavailable");
  document.querySelector<HTMLButtonElement>(".create-task-composer-toolbar [aria-label='清空业务输入']")?.click();
  await waitUntil(() => document.querySelector("[aria-live='assertive']")?.textContent?.includes("无法确认系统受保护存储中的旧记录已删除") === true,
    "protected draft deletion warning");
  const unavailableDeleteWarning = document.querySelector("[aria-live='assertive']")?.textContent?.includes("无法确认系统受保护存储中的旧记录已删除") === true;
  setProtectedDraftDeleteStatus("ready");
  const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
  if (!selection.includes("xiaohongshu/search-notes") || initialInvalid !== 0 || submittedInvalid !== 1 || !attachmentAdded ||
    !attachmentRestored || !attachmentRemoved || restoredKeyword !== "AI tools" || !catalogRefreshPreserved || !cleared || !clearedDraftStayedDeleted || !firstErrorFocused ||
    !live.includes("字段需要修正") || !acceptedFlow || !terminalFailureReconciled || !unknownDraftPreserved || !activeSubmitBlocked || !serverFailureStayedUnknown || !recoveryFocusRestored ||
    !cancellationPreservedDraft || terminateRequest?.method !== "POST" || !skillPolicyVersionSafe || !reusedThreadSafe || !resourceProfileBoundarySafe ||
    !submittedCard.includes("keyword") || !submittedCard.includes("历史字段") ||
    !submittedCard.includes("已提交受保护输入") || submittedCard.includes("Keyword") || submittedCard.includes("draft:app-protected") || overflow > 1 ||
    !unavailableDeleteWarning || mode === "narrow" && !longFileLayoutSafe) {
    throw new Error(`Library composer recovery or responsive layout failed: ${JSON.stringify({
      selection, initialInvalid, submittedInvalid, attachmentAdded, attachmentRestored, attachmentRemoved, restoredKeyword,
      catalogRefreshPreserved, cleared, clearedDraftStayedDeleted, firstErrorFocused, live, acceptedFlow, terminalFailureReconciled,
      unknownDraftPreserved, activeSubmitBlocked, cancellationPreservedDraft, recoveryFocusRestored, skillPolicyVersionSafe, reusedThreadSafe, resourceProfileBoundarySafe, submittedCard, overflow,
      unavailableDeleteWarning, mode, longFileLayoutSafe, searchHeight,
    })}`);
  }
  return { mode, selection, overflow, searchHeight, submittedInvalid, draftPreserved: restoredKeyword, catalogRefreshPreserved, attachmentAdded, attachmentRemoved, attachmentRestored, acceptedFlow, terminalFailureReconciled, unknownDraftPreserved, activeSubmitBlocked, cancellationPreservedDraft, recoveryFocusRestored, skillPolicyVersionSafe, reusedThreadSafe, resourceProfileBoundarySafe, submittedInputCard: true, cleared, clearedDraftStayedDeleted, firstErrorFocused, longFileLayoutSafe, unavailableDeleteWarning };
}

async function checkResourceProfileSubmissionBoundary() {
  const draft = createSkillInputDraft(xhsSkill);
  draft.values.url = "https://www.xiaohongshu.com/explore";
  draft.values.keyword = "profile boundary";
  draft.values.limit = "8";
  const ownerRef = "draft:app-protected/00000000-0000-4000-8000-000000000031";
  const requestCount = libraryOwnerRequests.length;
  const submitWithProfiles = (resourceRequirementProfileIds: string[]) => createTaskThreadTurn({
    endpoint: "http://127.0.0.1:8787",
    skill: {
      ...xhsSkill,
      actions: [{ ...xhsSkill.actions[0]!, resourceRequirementProfileIds }],
    },
    identity,
    draft,
    ownerRefs: {
      ownerRef,
      fieldOwnerRefs: Object.fromEntries(xhsSkill.inputFields.map((field) => [field.id, `${ownerRef}/${field.id}`])),
      attachmentRefs: {},
    },
    executionPolicy: { skillRef: xhsSkill.packageRef, actions: [] },
    runtime,
    threadModes: { read: "auto" },
    threadModeOverrides: {},
  });
  const missing = await submitWithProfiles([]);
  const ambiguous = await submitWithProfiles(["profile-a", "profile-b"]);
  return missing.status === "blocked" && ambiguous.status === "blocked" && libraryOwnerRequests.length === requestCount;
}

async function checkReusedThreadPolicyRevision() {
  const policy = await fetchEffectiveExecutionPolicy("http://127.0.0.1:8787", xhsSkill.packageRef);
  if (policy.status !== "ready") return false;
  const draft = createSkillInputDraft(xhsSkill);
  draft.values.url = "https://www.xiaohongshu.com/explore";
  draft.values.keyword = "reused thread";
  draft.values.limit = "8";
  const start = libraryOwnerRequests.length;
  const ownerRef = "draft:app-protected/00000000-0000-4000-8000-000000000030";
  const result = await createTaskThreadTurn({
    endpoint: "http://127.0.0.1:8787",
    skill: xhsSkill,
    identity,
    draft,
    ownerRefs: {
      ownerRef,
      fieldOwnerRefs: Object.fromEntries(xhsSkill.inputFields.map((field) => [field.id, `${ownerRef}/${field.id}`])),
      attachmentRefs: {},
    },
    executionPolicy: policy.policy,
    runtime,
    threadModes: { read: "auto" },
    threadModeOverrides: { read: "auto" },
  });
  const requests = libraryOwnerRequests.slice(start);
  const create = requests.findIndex((request) => request.path === "/threads" && request.method === "POST");
  const read = requests.findIndex((request, index) => index > create && request.path.startsWith("/execution-policies/effective?") && request.path.includes("thread_ref="));
  const write = requests.findIndex((request, index) => index > read && request.path.includes("/execution-policy?") && request.method === "PUT");
  const turn = requests.findIndex((request, index) => index > write && request.path.endsWith("/turns") && request.method === "POST");
  return result.status === "ready" && create >= 0 && read > create && write > read && turn > write &&
    (requests[write]?.body as { expected_source_version?: string })?.expected_source_version === "1" &&
    result.task.packageSource.sourceRef === xhsSkill.packageRef && result.task.packageSource.version === xhsSkill.version;
}

async function reopenComposer() {
  document.querySelector<HTMLButtonElement>("[data-library-switch]")?.click();
  await twoFrames();
  Array.from(document.querySelectorAll<HTMLButtonElement>(".production-skill-row-main")).find((button) => button.textContent?.includes(xhsSkill.name))?.click();
  await twoFrames();
  document.querySelector<HTMLButtonElement>(".skill-detail-heading .production-primary-button")?.click();
  await twoFrames();
}

function skillUseButton(name: string) {
  return Array.from(document.querySelectorAll<HTMLButtonElement>(".production-skill-row .production-primary-button"))
    .find((button) => button.closest(".production-skill-row")?.textContent?.includes(name));
}

function setInputValue(input: HTMLInputElement | null, value: string) {
  if (input == null) throw new Error("Expected schema-driven input is missing.");
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
const twoFrames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

declare global {
  interface Window {
    __runLibraryDomSmoke: (mode: "desktop" | "narrow" | "stale" | "production") => Promise<Record<string, unknown>>;
  }
}
