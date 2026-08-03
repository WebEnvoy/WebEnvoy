import { useEffect, useRef, useState } from "react";

import type { LodeCatalogSkill } from "./lodeCatalogClient";
import type { LocalConnectionConfig } from "./localConnectionConfig";
import type { TaskProjection } from "./taskThreadFixtures";
import { useAppSources } from "./useAppSources";
import { useAppTasks } from "./useAppTasks";
import { useSkillWorkbench } from "./useSkillWorkbench";
import { readTaskGrouping, readTaskSort, writeTaskGrouping, writeTaskSort, type TaskGrouping, type TaskSort } from "./workbenchPreferences";
import type { WorkbenchView } from "./WorkbenchSidebar";

export type WorkMode = "create" | "detail";

export function useAppController() {
  const sources = useAppSources();
  const navigation = useAppNavigation();
  const tasks = useAppTasks(
    sources.coreReadState,
    sources.connectionConfig.coreEndpoint,
    sources.runtimeSupervisorState,
    sources.harborIdentityState.identities,
  );
  const skillWorkbench = useSkillWorkbench({
    coreEndpoint: sources.connectionConfig.coreEndpoint,
    catalog: sources.lodeCatalogState,
    identities: sources.harborIdentityState.identities,
    runtime: sources.runtimeSupervisorState,
    onCatalogChange: sources.setLodeCatalogState,
    onOpenCreate: () => { navigation.setActiveView("work"); navigation.setWorkMode("create"); },
    onOpenIdentity: () => navigation.setActiveView("browser"),
    onOpenLibrary: () => navigation.setActiveView("library"),
  });
  const actions = createAppActions(sources, navigation, tasks, skillWorkbench);
  return { actions, navigation, skillWorkbench, sources, tasks };
}

export type AppController = ReturnType<typeof useAppController>;

function useAppNavigation() {
  const [activeView, setActiveView] = useState<WorkbenchView>("work");
  const [workMode, setWorkMode] = useState<WorkMode>("create");
  const [settingsReturnView, setSettingsReturnView] = useState<Exclude<WorkbenchView, "settings">>("work");
  const [taskGrouping, setTaskGrouping] = useState<TaskGrouping>(readTaskGrouping);
  const [taskSort, setTaskSort] = useState<TaskSort>(readTaskSort);
  const settingsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const settingsReturnFocusKeyRef = useRef<string | null>(null);
  useEffect(() => writeTaskGrouping(taskGrouping), [taskGrouping]);
  useEffect(() => writeTaskSort(taskSort), [taskSort]);

  function closeSettings() {
    const returnFocusKey = settingsReturnFocusKeyRef.current;
    settingsReturnFocusKeyRef.current = null;
    setActiveView(settingsReturnView);
    window.requestAnimationFrame(() => {
      const returnFocus = returnFocusKey == null
        ? settingsTriggerRef.current
        : document.querySelector<HTMLElement>(`[data-settings-return-focus="${returnFocusKey}"]`) ?? settingsTriggerRef.current;
      returnFocus?.focus();
    });
  }

  function openSettings() {
    if (activeView !== "settings") setSettingsReturnView(activeView);
    settingsReturnFocusKeyRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement.dataset.settingsReturnFocus ?? null
      : null;
    setActiveView("settings");
  }
  useEffect(() => {
    if (activeView !== "settings") return;
    const frame = window.requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-settings-initial-focus]")?.focus());
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || isTextEditingTarget(event.target)) return;
      event.preventDefault();
      closeSettings();
    };
    window.addEventListener("keydown", escape);
    return () => { window.cancelAnimationFrame(frame); window.removeEventListener("keydown", escape); };
  }, [activeView, settingsReturnView]);

  return {
    activeView, closeSettings, openSettings, settingsTriggerRef, setActiveView, setTaskGrouping,
    setTaskSort, setWorkMode, taskGrouping, taskSort, workMode,
  };
}

function createAppActions(
  sources: ReturnType<typeof useAppSources>,
  navigation: ReturnType<typeof useAppNavigation>,
  tasks: ReturnType<typeof useAppTasks>,
  skillWorkbench: ReturnType<typeof useSkillWorkbench>,
) {
  function selectTask(task: TaskProjection) {
    skillWorkbench.invalidateRequests();
    skillWorkbench.abandonIdentityRecovery();
    skillWorkbench.abandonSiteSkillRecovery();
    navigation.setActiveView("work");
    navigation.setWorkMode("detail");
    tasks.selectTask(task);
  }
  function acceptCreatedTask(task: TaskProjection) {
    tasks.acceptTaskThreadProjection(task);
    navigation.setActiveView("work");
    navigation.setWorkMode("detail");
  }
  function openTaskById(taskId: string) {
    const task = tasks.taskThreads.find((item) => item.id === taskId);
    if (task != null) selectTask(task);
  }
  function openView(view: Exclude<WorkbenchView, "settings">) {
    skillWorkbench.invalidateRequests();
    skillWorkbench.abandonSiteSkillRecovery();
    const resumeIdentityRecovery = view === "work" && navigation.activeView === "browser" &&
      skillWorkbench.resumeCreateTaskAfterIdentityRecovery();
    if (!resumeIdentityRecovery) skillWorkbench.abandonIdentityRecovery();
    navigation.setActiveView(view);
    if (view === "work") {
      if (!resumeIdentityRecovery) skillWorkbench.clearCreateTaskSelection();
      navigation.setWorkMode("create");
    }
  }
  function createTask(task?: TaskProjection) {
    skillWorkbench.invalidateRequests();
    skillWorkbench.abandonIdentityRecovery();
    skillWorkbench.abandonSiteSkillRecovery();
    const skill = task == null ? undefined : findCatalogSkillForTask(task, sources.lodeCatalogState.skills) ??
      findCurrentCatalogSkillForTaskGroup(task, sources.lodeCatalogState.skills);
    skillWorkbench.selectCreateTaskSkill(skill);
    navigation.setWorkMode("create");
    navigation.setActiveView("work");
  }
  function openSettings() {
    skillWorkbench.invalidateRequests();
    skillWorkbench.abandonIdentityRecovery();
    skillWorkbench.abandonSiteSkillRecovery();
    navigation.openSettings();
  }
  async function openResultDetail(detailRef: string) {
    return skillWorkbench.useResultDetail(detailRef, tasks.selectedTask?.threadContext?.accountIdentityKey);
  }
  function updateEndpoint(field: keyof LocalConnectionConfig, value: string) {
    skillWorkbench.invalidateRequests();
    sources.updateEndpoint(field, value);
  }
  return {
    acceptCreatedTask, createTask, openResultDetail, openSettings, openTaskById, openView, selectTask, updateEndpoint,
    onHarborStateChange: (state: typeof sources.harborIdentityState) => {
      skillWorkbench.invalidateRequests();
      sources.setHarborIdentityState(state);
    },
  };
}

export function findCatalogSkillForTask(task: TaskProjection, skills: LodeCatalogSkill[]) {
  return skills.find((skill) =>
    skill.packageRef === task.packageSource.sourceRef && skill.version === task.packageSource.version,
  );
}

function findCurrentCatalogSkillForTaskGroup(task: TaskProjection, skills: LodeCatalogSkill[]) {
  const capabilityId = task.threadContext?.siteSkillKey.split(/[/:]/).filter(Boolean).at(-1);
  return capabilityId == null ? undefined : skills.find((skill) => skill.packageRef.includes(`/${capabilityId}@`));
}

function isTextEditingTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && target.closest("input, textarea, select, [contenteditable='true']") != null;
}
