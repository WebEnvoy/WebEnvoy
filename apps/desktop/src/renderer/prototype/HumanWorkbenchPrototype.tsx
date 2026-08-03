import {
  ArrowLeft,
  ArrowRight,
  CircleUserRound,
  Copy,
  Library,
  Pencil,
  Settings,
  SquarePen,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { AppShell, LeftPanel, RightPanel, ThreadWorkspace } from "../shellPrimitives";
import { BrowserSurface } from "./BrowserSurface";
import { LibrarySurface, SettingsSurface } from "./LibrarySettingsSurfaces";
import {
  PrototypeSidebar,
  type TaskGrouping,
  type TaskSort,
} from "./PrototypeSidebar";
import { PrototypeArtifactPanel } from "./PrototypeArtifactPanel";
import {
  actionCategories,
  defaultExecutionPolicy,
  identities as initialIdentities,
  identityCanUseSkill,
  initialActionCategoryForTask,
  recommendedExecutionPolicy,
  snapshotSubmittedFields,
  skills,
  tasks,
  type AppView,
  type ActionCategory,
  type ExecutionPolicy,
  type Identity,
  type ProxyProfile,
  type PrototypePreviewSelection,
  type PrototypeRun,
  type PrototypeTask,
} from "./prototypeData";
import { PrototypeTaskThreadComposer, WorkSurface } from "./WorkSurface";

type WorkMode = "detail" | "create";
type BrowserMode = "catalog" | "detail" | "create" | "repair" | "edit" | "dependencies";
type LibraryMode = "catalog" | "detail" | "create";
type SettingsSection = "general" | "authorization" | "proxies" | "diagnostics";

const TASK_GROUPING_KEY = "webenvoy.prototype.task-grouping";
const TASK_SORT_KEY = "webenvoy.prototype.task-sort";

export function HumanWorkbenchPrototype() {
  const [view, setView] = useState<AppView>("work");
  const [workMode, setWorkMode] = useState<WorkMode>("detail");
  const [browserMode, setBrowserMode] = useState<BrowserMode>("detail");
  const [libraryMode, setLibraryMode] = useState<LibraryMode>("catalog");
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("general");
  const [settingsReturnView, setSettingsReturnView] = useState<Exclude<AppView, "settings">>("work");
  const [selectedTaskId, setSelectedTaskId] = useState(tasks[0].id);
  const [taskList, setTaskList] = useState<PrototypeTask[]>(tasks);
  const [taskGrouping, setTaskGrouping] = useState<TaskGrouping>(readTaskGrouping);
  const [taskSort, setTaskSort] = useState<TaskSort>(readTaskSort);
  const [selectedIdentityId, setSelectedIdentityId] = useState(initialIdentities[0].id);
  const [selectedSkillId, setSelectedSkillId] = useState(skills[0].id);
  const [librarySiteFilter, setLibrarySiteFilter] = useState("全部");
  const [identityList, setIdentityList] = useState<Identity[]>(initialIdentities);
  const [proxyList, setProxyList] = useState<ProxyProfile[]>([
    { id: "team", name: "团队推荐线路", address: "proxy-cn.example:1080", latency: "上海 · 42 ms", state: "可用" },
    { id: "jp", name: "日本采集线路", address: "proxy-jp.example:1080", latency: "东京 · 86 ms", state: "可用" },
  ]);
  const [identityCreationSite, setIdentityCreationSite] = useState("小红书");
  const [returnToTaskCreation, setReturnToTaskCreation] = useState(false);
  const [pendingTaskDraft, setPendingTaskDraft] = useState<Record<string, string> | undefined>();
  const [preferredIdentityId, setPreferredIdentityId] = useState("");
  const [cloakProviderInstalled, setCloakProviderInstalled] = useState(false);
  const [globalPolicy, setGlobalPolicy] = useState<ExecutionPolicy>({ ...defaultExecutionPolicy });
  const [skillPolicies, setSkillPolicies] = useState<Record<string, ExecutionPolicy>>(() => Object.fromEntries(skills.filter((skill) => skill.availability === "available").map((skill) => [skill.id, recommendedExecutionPolicy(skill)])));
  const [disabledSkillIds, setDisabledSkillIds] = useState<string[]>([]);
  const [threadExecutionModes, setThreadExecutionModes] = useState<Record<string, Partial<ExecutionPolicy>>>({});
  const [previewSelection, setPreviewSelection] = useState<PrototypePreviewSelection | null>(null);
  const [resultPreviewRequestKey, setResultPreviewRequestKey] = useState(0);
  const [resultPreviewCloseKey, setResultPreviewCloseKey] = useState(0);
  const [artifactTabHost, setArtifactTabHost] = useState<HTMLDivElement | null>(null);
  const [composerEditRequest, setComposerEditRequest] = useState<{ runId: string; inputs: Record<string, string>; attachments: string[] } | null>(null);
  const recoveryRequestRef = useRef(0);
  const selectedTask = taskList.find((task) => task.id === selectedTaskId) ?? taskList[0];
  const previewRun = previewSelection == null ? null : selectedTask.runs?.find((run) => run.id === previewSelection.runId) ?? null;
  const selectedTaskIdentity = identityList.find((identity) => identity.id === selectedTask.identityId);
  const selectedIdentity: Identity | undefined =
    identityList.find((identity) => identity.id === selectedIdentityId) ?? identityList[0];
  const selectedSkill = skills.find((skill) => skill.id === selectedSkillId) ?? skills[0];
  const selectedTaskSkill = skills.find((skill) => skill.name === selectedTask.skill && skill.site === selectedTask.site);
  const selectedTaskCategory = initialActionCategoryForTask(selectedTask.kind);
  const selectedTaskActionDeclared = selectedTaskSkill?.actionCategories.includes(selectedTaskCategory) ?? false;
  const selectedTaskSkillEnabled = selectedTaskSkill != null && !disabledSkillIds.includes(selectedTaskSkill.id);
  const selectedTaskIdentityMissing = selectedTaskIdentity == null;
  const selectedTaskSkillPolicy = selectedTaskSkill == null ? undefined : skillPolicies[selectedTaskSkill.id];
  const selectedTaskThreadPolicy = threadExecutionModes[selectedTask.id];
  const selectedTaskExecutionModes = Object.fromEntries(actionCategories.map((category) => {
    const declared = selectedTaskSkill?.actionCategories.includes(category) ?? false;
    return [category, declared ? selectedTaskThreadPolicy?.[category] ?? selectedTaskSkillPolicy?.[category] ?? globalPolicy[category] : "block"];
  })) as ExecutionPolicy;
  const selectedTaskExecutionSources = Object.fromEntries(actionCategories.map((category) => {
    const declared = selectedTaskSkill?.actionCategories.includes(category) ?? false;
    return [category, declared ? selectedTaskThreadPolicy?.[category] != null ? "当前线程" : selectedTaskSkillPolicy != null ? "我的技能默认" : "全局默认" : "技能声明不匹配"];
  })) as Record<(typeof actionCategories)[number], string>;
  useEffect(() => {
    try {
      window.localStorage.setItem(TASK_GROUPING_KEY, taskGrouping);
    } catch {
      // A display preference must not block the prototype.
    }
  }, [taskGrouping]);

  useEffect(() => {
    try {
      window.localStorage.setItem(TASK_SORT_KEY, taskSort);
    } catch {
      // A display preference must not block the prototype.
    }
  }, [taskSort]);

  useEffect(() => {
    setResultPreviewCloseKey((current) => current + 1);
  }, [selectedTaskId]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const heading = document.querySelector<HTMLElement>(".main-content-viewport h1");
      if (heading != null) {
        heading.tabIndex = -1;
        heading.focus();
      } else {
        document.querySelector<HTMLElement>('[data-focus-area="thread-workspace"]')?.focus();
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [browserMode, libraryMode, settingsSection, view, workMode]);

  const pageTitle = useMemo(() => {
    if (view === "work") {
      return workMode === "create" ? "创建任务" : `${selectedTask.skill} · ${selectedTaskIdentity?.account ?? selectedTask.identity}`;
    }
    if (view === "browser") {
      if (browserMode === "catalog") return "账号身份";
      if (browserMode === "create") return "创建账号身份";
      if (browserMode === "repair") return "修复浏览器 Provider";
      if (browserMode === "edit") return selectedIdentity == null ? "账号身份" : `编辑 ${selectedIdentity.name}`;
      if (browserMode === "dependencies") return "环境依赖";
      return selectedIdentity?.account ?? "账号身份";
    }
    if (view === "library") {
      if (libraryMode === "detail") return selectedSkill.name;
      if (libraryMode === "create") return "新增站点技能";
      return librarySiteFilter === "全部" ? "发现站点技能" : librarySiteFilter;
    }
    if (settingsSection === "general") return "通用";
    if (settingsSection === "authorization") return "执行方式";
    if (settingsSection === "proxies") return "代理管理";
    return "诊断";
  }, [browserMode, libraryMode, librarySiteFilter, selectedIdentity?.account, selectedIdentity?.name, selectedSkill.name, selectedTask.identity, selectedTask.skill, selectedTaskIdentity?.account, settingsSection, view, workMode]);

  function openView(nextView: AppView) {
    setView(nextView);
    if (nextView === "work") setWorkMode("create");
    if (nextView === "browser") setBrowserMode("catalog");
    if (nextView === "library") {
      setLibraryMode("catalog");
      setLibrarySiteFilter("全部");
    }
  }

  function openSettings(section: SettingsSection) {
    setSettingsSection(section);
    if (view !== "settings") setSettingsReturnView(view);
    setView("settings");
  }

  function openTask(taskId: string) {
    setSelectedTaskId(taskId);
    setComposerEditRequest(null);
    setPreviewSelection(null);
    setWorkMode("detail");
    setView("work");
  }

  function createTask(skillId?: string, identityId?: string) {
    if (skillId != null && disabledSkillIds.includes(skillId)) return;
    if (skillId != null) setSelectedSkillId(skillId);
    setPreferredIdentityId(identityId ?? "");
    setWorkMode("create");
    setView("work");
  }

  function createTaskForSkill(site: string, skillName: string) {
    const skill = skills.find((item) => item.site === site && item.name === skillName && item.availability === "available" && !disabledSkillIds.includes(item.id));
    if (skill == null) return;
    const usedIdentityIds = new Set(taskList.filter((task) => task.site === site && task.skill === skillName).map((task) => task.identityId));
    const alternativeIdentity = identityList.find((identity) => identityCanUseSkill(identity, skill) && !usedIdentityIds.has(identity.id));
    createTask(skill.id, alternativeIdentity?.id);
  }

  function submitTask(task: PrototypeTask, executionModes?: Partial<ExecutionPolicy>) {
    const submittedSkill = skills.find((skill) => skill.site === task.site && skill.name === task.skill);
    if (submittedSkill == null || disabledSkillIds.includes(submittedSkill.id)) return;
    const existingThread = taskList.find((item) => item.site === task.site && item.skill === task.skill && item.identityId === task.identityId);
    if (existingThread?.runs?.some((run) => isActiveRunState(run.state))) return;
    const threadId = existingThread?.id ?? task.id;
    const run = task.runs?.[0] ?? { id: `run-${Date.now()}`, label: "本回合", input: task.title, state: task.state, stateLabel: task.stateLabel, summary: task.summary };
    const persistedRun = existingThread == null ? run : { ...run, id: `run-${Date.now()}`, label: `回合 ${(existingThread.runs?.length ?? 0) + 1}` };
    if (executionModes != null && Object.keys(executionModes).length > 0) setThreadExecutionModes((current) => ({ ...current, [threadId]: { ...current[threadId], ...executionModes } }));
    if (existingThread == null) {
      setTaskList((current) => [{ ...task, runs: [persistedRun] }, ...current]);
      setSelectedTaskId(task.id);
    } else {
      setTaskList((current) => current.map((item) => item.id === existingThread.id ? {
        ...item,
        state: task.state,
        stateLabel: task.stateLabel,
        updatedAt: task.updatedAt,
        summary: task.summary,
        runs: [...(item.runs ?? []), persistedRun],
        artifactSet: task.artifactSet,
        artifactState: task.artifactState,
      } : item));
      setSelectedTaskId(existingThread.id);
    }
    setPreviewSelection(null);
    setPendingTaskDraft(undefined);
    setWorkMode("detail");
    setView("work");
    if (persistedRun.actionCategory === "prepare") schedulePreparedRunCompletion(threadId, persistedRun.id);
  }

  function submitTaskTurn(inputs: Record<string, string>, attachments?: string[], actionCategory: ActionCategory = selectedTaskCategory, executionSource?: string) {
    const skill = selectedTaskSkill;
    if (skill == null || !selectedTaskSkillEnabled || selectedTaskIdentityMissing || !skill.actionCategories.includes(actionCategory)) return;
    if (selectedTask.runs?.some((run) => isActiveRunState(run.state))) return;
    const executionMode = selectedTaskExecutionModes[actionCategory];
    if (executionMode === "block") return;
    const input = inputs[skill.inputFields[0]?.key ?? ""]?.trim() ?? "";
    const quantity = Number(inputs.quantity);
    const runId = `run-${Date.now()}`;
    const run: PrototypeRun = {
      id: runId,
      label: selectedTask.skill,
      input,
      inputs,
      submittedFields: snapshotSubmittedFields(skill, inputs),
      fieldSchemaVersion: skill.inputSchemaVersion,
      state: "running",
      stateLabel: "正在运行",
      summary: `正在执行“${selectedTask.skill}”。`,
      source: "App",
      attachments,
      artifactSet: selectedTask.artifactSet,
      artifactState: "pending",
      artifactTotal: Number.isFinite(quantity) ? quantity : undefined,
      outputView: skills.find((skill) => skill.site === selectedTask.site && skill.name === selectedTask.skill)?.outputView,
      executionMode,
      executionSource: executionSource ?? selectedTaskExecutionSources[actionCategory],
      actionCategory,
      executionRecords: [{ actionCategory, executionMode, executionSource: executionSource ?? selectedTaskExecutionSources[actionCategory], outcome: "running" }],
    };
    setTaskList((current) => current.map((task) => task.id === selectedTask.id ? {
      ...task,
      state: "running",
      stateLabel: "正在运行",
      updatedAt: "刚刚",
      summary: `已提交“${input}”，结果会在当前线程持续更新。`,
      runs: [...(task.runs ?? []), run],
      artifactState: "pending",
      artifactTotal: Number.isFinite(quantity) ? quantity : task.artifactTotal,
    } : task));
    setPreviewSelection(null);
    setComposerEditRequest(null);
    window.setTimeout(() => document.querySelector(`[data-content-search-unit-key="${selectedTask.id}-${runId}"]`)?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" }), 0);
    if (actionCategory === "prepare") schedulePreparedRunCompletion(selectedTask.id, runId);
  }

  function schedulePreparedRunCompletion(taskId: string, runId: string) {
    window.setTimeout(() => setTaskList((current) => current.map((task) => {
      if (task.id !== taskId || task.runs?.find((run) => run.id === runId)?.state !== "running") return task;
      return {
        ...task,
        state: "not-submitted",
        stateLabel: "未提交",
        updatedAt: "刚刚",
        summary: "内容已填写并校验，尚未发布。",
        artifactState: "ready",
        runs: (task.runs ?? []).map((run) => run.id === runId ? {
          ...run,
          state: "not-submitted",
          stateLabel: "未提交",
          summary: "页面内容已填写并校验，尚未发布。",
          duration: "34 秒",
          endedAt: "刚刚",
          artifactState: "ready",
          executionRecords: run.executionRecords?.map((record) => record.outcome === "running" ? { ...record, outcome: "completed" as const } : record),
        } : run),
      };
    })), 700);
  }

  function stopTaskTurn() {
    setTaskList((current) => current.map((task) => task.id === selectedTask.id ? {
      ...task,
      state: "cancelled",
      stateLabel: "已停止",
      updatedAt: "刚刚",
      summary: "当前回合已由用户停止。",
      runs: (task.runs ?? []).map((run, index, runs) => index === runs.length - 1 && run.state === "running" ? { ...run, state: "cancelled", stateLabel: "已停止", summary: "当前回合已由用户停止。", endedAt: "刚刚", artifactState: "none", executionRecords: run.executionRecords?.map((record) => record.outcome === "running" ? { ...record, outcome: "cancelled" as const } : record) } : run),
      artifactState: "none",
    } : task));
  }

  function continueWriteTask(runId: string, executionSource: string) {
    const mode = selectedTaskExecutionModes.external;
    if (!selectedTaskSkill?.actionCategories.includes("external") || mode === "block") return;
    setTaskList((current) => current.map((task) => task.id === selectedTask.id ? {
      ...task,
      state: "success",
      stateLabel: "已提交",
      summary: "内容已经发布。",
      updatedAt: "刚刚",
      runs: (task.runs ?? []).map((run) => run.id === runId && run.state === "not-submitted" ? {
        ...run,
        state: "success",
        stateLabel: "已提交",
        summary: "内容已经发布。",
        endedAt: "刚刚",
        executionRecords: [
          ...(run.executionRecords ?? [{ actionCategory: run.actionCategory ?? "prepare", executionMode: run.executionMode ?? "auto", executionSource: run.executionSource ?? "历史回合未记录来源", outcome: "completed" as const }]).map((record) => record.outcome === "running" ? { ...record, outcome: "completed" as const } : record),
          { actionCategory: "external", executionMode: mode, executionSource, outcome: "completed" },
        ],
      } : run),
    } : task));
  }

  function abortTakeover() {
    setTaskList((current) => current.map((task) => task.id === selectedTask.id ? {
      ...task,
      state: "cancelled",
      stateLabel: "已停止",
      summary: "登录未完成，本回合已终止。",
      updatedAt: "刚刚",
      runs: (task.runs ?? []).map((run, index, runs) => index === runs.length - 1 ? { ...run, state: "cancelled", stateLabel: "已停止", summary: "登录未完成，本回合已终止。", endedAt: "刚刚" } : run),
    } : task));
  }

  function reconnectTask() {
    const currentRun = selectedTask.runs?.at(-1);
    if (selectedTask.state !== "unknown" || currentRun == null) return;
    const attempt = currentRun.recoveryAttempts ?? 0;
    const requestId = ++recoveryRequestRef.current;
    setTaskList((current) => current.map((task) => task.id === selectedTask.id ? {
      ...task,
      state: "checking",
      stateLabel: "正在检查",
      summary: "正在重新读取运行事实；不会重复提交。",
      runs: (task.runs ?? []).map((run, index, runs) => index === runs.length - 1 ? { ...run, state: "checking", stateLabel: "正在检查", summary: "正在重新读取运行事实。" } : run),
    } : task));
    window.setTimeout(() => {
      if (recoveryRequestRef.current !== requestId) return;
      setTaskList((current) => current.map((task) => task.id === selectedTask.id ? attempt === 0 ? {
      ...task,
      state: "unknown",
      stateLabel: "仍无法确认",
      summary: "运行服务仍不可达，可以稍后重试或终止这个回合。",
      runs: (task.runs ?? []).map((run, index, runs) => index === runs.length - 1 ? { ...run, state: "unknown", stateLabel: "仍无法确认", summary: "运行服务仍不可达。", recoveryAttempts: attempt + 1 } : run),
    } : {
      ...task,
      state: "success",
      stateLabel: "已完成",
      summary: "重新读取运行事实后确认回合已完成，没有重复提交。",
      updatedAt: "刚刚",
      artifactState: "ready",
      runs: (task.runs ?? []).map((run, index, runs) => index === runs.length - 1 ? { ...run, state: "success", stateLabel: "已完成", summary: "重连后确认回合已完成。", duration: "27 秒", endedAt: "刚刚", artifactState: "ready", recoveryAttempts: attempt + 1 } : run),
      } : task));
    }, 700);
  }

  function terminateUnknownTask() {
    const requestId = ++recoveryRequestRef.current;
    setTaskList((current) => current.map((task) => task.id === selectedTask.id && (task.state === "unknown" || task.state === "checking") ? {
      ...task,
      state: "checking",
      stateLabel: "正在终止",
      summary: "已发送终止请求，正在等待运行服务确认；不会解锁新的提交。",
      updatedAt: "刚刚",
      runs: (task.runs ?? []).map((run, index, runs) => index === runs.length - 1 ? { ...run, state: "checking", stateLabel: "正在终止", summary: "已发送终止请求，等待运行服务确认。" } : run),
    } : task));
    window.setTimeout(() => {
      if (recoveryRequestRef.current !== requestId) return;
      setTaskList((current) => current.map((task) => task.id === selectedTask.id && task.state === "checking" && task.stateLabel === "正在终止" ? {
        ...task,
        state: "cancelled",
        stateLabel: "已终止",
        summary: "运行服务已确认回合终止；未自动重试。",
        updatedAt: "刚刚",
        artifactState: "none",
        runs: (task.runs ?? []).map((run, index, runs) => index === runs.length - 1 ? { ...run, state: "cancelled", stateLabel: "已终止", summary: "运行服务已确认回合终止。", endedAt: "刚刚", artifactState: "none", executionRecords: run.executionRecords?.map((record) => record.outcome === "running" ? { ...record, outcome: "cancelled" as const } : record) } : run),
      } : task));
    }, 700);
  }

  function returnWriteToEdit(run: PrototypeRun) {
    const skill = selectedTaskSkill;
    if (skill == null) return;
    const inputs = run.inputs ?? { [skill.inputFields[0]?.key ?? "content"]: run.input };
    setComposerEditRequest({ runId: run.id, inputs, attachments: run.attachments ?? [] });
  }

  function openPreview(selection: PrototypePreviewSelection) {
    setPreviewSelection(selection);
    setResultPreviewRequestKey((current) => current + 1);
  }

  function openIdentityInstance(identityId: string) {
    setIdentityList((current) => current.map((identity) => {
      if (identity.id !== identityId || identity.sessionState === "running") return identity;
      return {
        ...identity,
        state: "running",
        stateLabel: "运行中",
        sessionState: "running",
        controller: "用户控制",
        currentPage: identity.currentPage ?? defaultIdentityPage(identity.site),
        lastHealthyAt: "刚刚",
        detail: "实例运行中 · 用户控制",
      };
    }));
  }

  function completeTakeover(taskId: string, identityId: string) {
    const pausedTask = taskList.find((task) => task.id === taskId && task.identityId === identityId && task.kind === "takeover" && task.state === "waiting");
    if (pausedTask == null) return;
    setTaskList((current) => current.map((task) => task.id === pausedTask.id ? {
      ...task,
      state: "running",
      stateLabel: "正在继续",
      updatedAt: "刚刚",
      summary: "登录状态校验成功，任务已恢复执行。",
      runs: (task.runs ?? []).map((run, index, runs) => index === runs.length - 1 ? { ...run, state: "running", stateLabel: "正在继续", summary: "登录状态校验成功，当前回合已恢复。", artifactState: "pending" } : run),
      artifactState: "pending",
    } : task));
    setIdentityList((current) => current.map((identity) => identity.id === identityId ? {
      ...identity,
      state: "running",
      stateLabel: "运行中",
      loginState: "logged-in",
      sessionState: "running",
      controller: "任务占用",
      currentPage: `${identity.site} 收藏夹`,
      lastHealthyAt: "刚刚",
      detail: "登录已确认 · 任务正在继续",
    } : identity));
  }

  function openIdentity(identityId: string) {
    setSelectedIdentityId(identityId);
    setBrowserMode("detail");
    setView("browser");
  }

  function openSkill(skillId: string) {
    setSelectedSkillId(skillId);
    setLibraryMode("detail");
    setView("library");
  }

  function saveIdentity(identity: Identity) {
    setIdentityList((current) => [identity, ...current]);
    setSelectedIdentityId(identity.id);
    setBrowserMode("detail");
    if (returnToTaskCreation && identity.loginState !== "login-required") {
      setReturnToTaskCreation(false);
      setPreferredIdentityId(identity.id);
      setWorkMode("create");
      setView("work");
    }
  }

  function completeIdentityLogin(identityId: string) {
    setIdentityList((current) => current.map((identity) => identity.id === identityId ? { ...identity, loginState: "logged-in", state: "available", stateLabel: "可用", sessionState: "idle", controller: "空闲", detail: "登录已确认 · 环境可用" } : identity));
    if (returnToTaskCreation) {
      setReturnToTaskCreation(false);
      setPreferredIdentityId(identityId);
      setWorkMode("create");
      setView("work");
    }
  }

  function duplicateIdentity(completeCopy: boolean) {
    const source = selectedIdentity;
    if (source == null) return;
    const providerUnavailable = source.provider === "CloakBrowser" && !cloakProviderInstalled;
    const copiedLoginState = completeCopy ? source.loginState ?? "unknown" : "not-required";
    const loginReady = copiedLoginState === "logged-in" || copiedLoginState === "not-required";
    const duplicate: Identity = {
      ...source,
      id: `identity-${Date.now()}`,
      name: completeCopy ? `${source.name} 副本` : `${source.site} 环境副本`,
      account: completeCopy ? source.account : `${source.site} 环境副本`,
      accountAvatar: completeCopy ? source.accountAvatar : source.site.slice(0, 1),
      platformId: completeCopy ? source.platformId : undefined,
      tags: completeCopy ? source.tags : [source.site],
      loginState: copiedLoginState,
      sessionState: providerUnavailable ? "failed" : "idle",
      state: providerUnavailable ? "repair" : loginReady ? "available" : "login",
      stateLabel: providerUnavailable ? "需要修复" : loginReady ? "可用" : "需要登录",
      controller: "空闲",
      currentPage: undefined,
      lastHealthyAt: "尚未启动",
      detail: providerUnavailable ? "环境已复制 · CloakBrowser 未安装" : completeCopy ? "完整副本已创建 · 登录状态已保留" : "环境配置已复制 · 未包含账号资料和站点数据",
    };
    setIdentityList((current) => [duplicate, ...current]);
    setSelectedIdentityId(duplicate.id);
  }

  function goBack() {
    if (view === "work" && workMode === "create") setWorkMode("detail");
    else if (view === "browser" && browserMode === "detail") setBrowserMode("catalog");
    else if (view === "browser" && browserMode !== "catalog") setBrowserMode(browserMode === "create" ? "catalog" : "detail");
    else if (view === "library" && libraryMode !== "catalog") setLibraryMode("catalog");
    else if (view === "settings") setView(settingsReturnView);
  }

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape" || view !== "settings" || isTextEditingTarget(event.target)) return;
      event.preventDefault();
      setView(settingsReturnView);
    }
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [settingsReturnView, view]);

  const canGoBack =
    (view === "work" && workMode === "create") ||
    (view === "browser" && browserMode !== "catalog") ||
    (view === "library" && libraryMode !== "catalog") ||
    view === "settings";

  return (
    <AppShell
      collapsePanelsOnNarrow
      initialRightOpen={false}
      rightPanelCloseRequestKey={resultPreviewCloseKey || undefined}
      rightPanelOpenRequestKey={resultPreviewRequestKey || undefined}
      left={
        <LeftPanel>
          <PrototypeSidebar
            identities={identityList}
            settingsSection={settingsSection}
            selectedTaskId={selectedTask.id}
            taskList={taskList}
            taskGrouping={taskGrouping}
            taskSort={taskSort}
            view={view}
            onCreate={() => createTask()}
            onCreateTaskForSkill={createTaskForSkill}
            onOpenTask={openTask}
            onOpenSettingsSection={openSettings}
            onOpenView={openView}
            onTaskGroupingChange={setTaskGrouping}
            onTaskSortChange={setTaskSort}
          />
        </LeftPanel>
      }
      header={(panelControls) => (
        <header className="shell-topbar prototype-topbar" aria-label="应用工具栏">
          <div className="topbar-left-slot">
            {panelControls.left}
            <button className="topbar-icon-button" type="button" aria-label="后退" disabled={!canGoBack} onClick={goBack}>
              <ArrowLeft size={15} />
            </button>
            <button className="topbar-icon-button" type="button" aria-label="前进" disabled>
              <ArrowRight size={15} />
            </button>
          </div>
          <div className="topbar-center-surface">
            <span className="topbar-thread-symbol" aria-hidden="true">
              {view === "work" ? <SquarePen size={15} /> : view === "browser" ? <CircleUserRound size={15} /> : view === "library" ? <Library size={15} /> : <Settings size={15} />}
            </span>
            <h2>{pageTitle}</h2>
            <div className="prototype-center-actions">
              {view === "browser" && browserMode === "detail" ? (
                <><button className="topbar-icon-button" type="button" aria-label="编辑身份" title="编辑身份" onClick={() => setBrowserMode("edit")}><Pencil size={14} /></button><details className="identity-copy-menu" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) event.currentTarget.removeAttribute("open"); }} onKeyDown={(event) => { if (event.key === "Escape") { event.currentTarget.removeAttribute("open"); event.currentTarget.querySelector("summary")?.focus(); } }}>
                  <summary className="topbar-icon-button" role="button" aria-label="创建副本" title="创建副本"><Copy size={14} /></summary>
                  <div role="menu" aria-label="创建账号身份副本">
                    <button type="button" role="menuitem" onClick={(event) => { duplicateIdentity(true); event.currentTarget.closest("details")?.removeAttribute("open"); }}><strong>完整复制</strong><small>包含账号资料、登录状态和环境配置</small></button>
                    <button type="button" role="menuitem" onClick={(event) => { duplicateIdentity(false); event.currentTarget.closest("details")?.removeAttribute("open"); }}><strong>仅复制环境配置</strong><small>不包含账号资料和站点数据</small></button>
                  </div>
                </details></>
              ) : null}
            </div>
          </div>
          <div className="topbar-right-slot prototype-right-topbar">
            {view === "work" && workMode === "detail" ? <><div className="prototype-right-tab-host" data-focus-area="right-panel" ref={setArtifactTabHost} />{panelControls.rightFullscreen}{panelControls.right}</> : null}
          </div>
        </header>
      )}
      workspace={
        <ThreadWorkspace composer={view === "work" && workMode === "detail" ? <PrototypeTaskThreadComposer key={selectedTask.id} actionCategories={selectedTaskActionDeclared ? selectedTaskSkill!.actionCategories : []} actionCategory={selectedTaskCategory} blockedReason={!selectedTaskSkillEnabled ? "站点技能已停用，请重新启用后再提交" : selectedTaskIdentityMissing ? "账号身份已删除，请创建新线程" : undefined} editRequest={composerEditRequest} executionLocked={!selectedTaskActionDeclared || !selectedTaskSkillEnabled || selectedTaskIdentityMissing} executionModes={selectedTaskExecutionModes} executionSources={selectedTaskExecutionSources} identityLabel={selectedTaskIdentity?.account ?? selectedTask.identity} task={selectedTask} onExecutionModeChange={(category, mode) => setThreadExecutionModes((current) => ({ ...current, [selectedTask.id]: { ...current[selectedTask.id], [category]: mode } }))} onSaveAsSkillDefaults={() => {
          if (selectedTaskSkill == null) return;
          setSkillPolicies((current) => ({ ...current, [selectedTaskSkill.id]: { ...(current[selectedTaskSkill.id] ?? globalPolicy), ...selectedTaskThreadPolicy } }));
          setThreadExecutionModes((current) => { const next = { ...current }; delete next[selectedTask.id]; return next; });
        }} onStop={stopTaskTurn} onSubmit={submitTaskTurn} /> : undefined}>
          {view === "work" ? (
            <WorkSurface
              globalPolicy={globalPolicy}
              identities={identityList}
              initialTaskDraft={pendingTaskDraft}
              mode={workMode}
              preferredIdentityId={preferredIdentityId}
              selectedSkill={selectedSkill}
              selectedSkillEnabled={!disabledSkillIds.includes(selectedSkill.id)}
              skillPolicy={skillPolicies[selectedSkill.id]}
              task={selectedTask}
              taskExecutionModes={selectedTaskExecutionModes}
              taskExecutionSources={selectedTaskExecutionSources}
              tasks={taskList}
              threadExecutionModes={threadExecutionModes}
              onCreateIdentity={(inputs) => {
                setPendingTaskDraft(inputs);
                setIdentityCreationSite(selectedSkill.site);
                setReturnToTaskCreation(true);
                setBrowserMode("create");
                setView("browser");
              }}
              onCreateTask={submitTask}
              onOpenPreview={openPreview}
              onOpenBrowser={() => {
                openIdentityInstance(selectedTask.identityId);
              }}
              onOpenLibrary={() => {
                setLibraryMode("catalog");
                setView("library");
              }}
              onContinueWrite={continueWriteTask}
              onReconnectTask={reconnectTask}
              onRecoverIdentity={() => selectedTaskSkill == null ? undefined : createTask(selectedTaskSkill.id)}
              onReturnWriteToEdit={returnWriteToEdit}
              onTakeoverAborted={abortTakeover}
              onTakeoverCompleted={() => completeTakeover(selectedTask.id, selectedTask.identityId)}
              onTerminateUnknownTask={terminateUnknownTask}
              onSelectSkill={setSelectedSkillId}
            />
          ) : null}
          {view === "browser" ? (
            <BrowserSurface
              cloakProviderInstalled={cloakProviderInstalled}
              identity={selectedIdentity}
              identities={identityList}
              initialIdentitySite={identityCreationSite}
              mode={browserMode}
              proxies={proxyList}
              tasks={taskList}
              onCreate={saveIdentity}
              onCreateRequested={() => {
                setIdentityCreationSite("小红书");
                setReturnToTaskCreation(false);
                setBrowserMode("create");
              }}
              onModeChange={setBrowserMode}
              onOpenIdentity={openIdentity}
              onLoginCompleted={completeIdentityLogin}
              onManageProxies={() => {
                openSettings("proxies");
              }}
              onOpenInstance={openIdentityInstance}
              onStopInstance={(identityId) => setIdentityList((current) => current.map((identity) => identity.id === identityId ? { ...identity, state: "available", stateLabel: "可用", sessionState: "idle", controller: "空闲", currentPage: undefined, detail: "实例已停止 · 环境可用" } : identity))}
              onProviderRepaired={() => {
                setCloakProviderInstalled(true);
                setIdentityList((current) => current.map((identity) => identity.provider === "CloakBrowser" && identity.state === "repair" ? {
                  ...identity,
                  state: identity.loginState === "logged-in" || identity.loginState === "not-required" ? "available" : "login",
                  stateLabel: identity.loginState === "logged-in" || identity.loginState === "not-required" ? "可用" : "需要登录",
                  detail: identity.loginState === "logged-in" || identity.loginState === "not-required" ? "空闲 · Provider 刚刚完成验证" : "Provider 已验证 · 等待登录确认",
                  sessionState: "idle",
                  controller: "空闲",
                  lastHealthyAt: "尚未启动",
                } : identity));
              }}
              onDeleteIdentity={(identityId, deleteEnvironment) => {
                const remaining = identityList.filter((identity) => identity.id !== identityId);
                setIdentityList(remaining);
                setTaskList((current) => current.map((task) => task.identityId === identityId ? { ...task, identity: `${task.identity}（已删除）`, identityRemoval: deleteEnvironment ? "environment-deleted" : "app-removed" } : task));
                setSelectedIdentityId(remaining[0]?.id ?? "");
                setBrowserMode(remaining.length > 0 ? "detail" : "catalog");
              }}
              onUpdateIdentity={(updated) => {
                setIdentityList((current) => current.map((identity) => identity.id === updated.id ? updated : identity));
                setBrowserMode("detail");
              }}
              onUseSkill={() => {
                if (selectedIdentity == null) return;
                const compatibleSkill = skills.find((skill) => skill.availability === "available" && identityCanUseSkill(selectedIdentity, skill));
                if (compatibleSkill != null) createTask(compatibleSkill.id, selectedIdentity.id);
              }}
            />
          ) : null}
          {view === "library" ? (
            <LibrarySurface
              mode={libraryMode}
              disabledSkillIds={disabledSkillIds}
              siteFilter={librarySiteFilter}
              selectedSkill={selectedSkill}
              skillPolicies={skillPolicies}
              onModeChange={setLibraryMode}
              onSelectSkill={setSelectedSkillId}
              onSkillPolicyChange={(skillId, policy) => setSkillPolicies((current) => ({ ...current, [skillId]: policy }))}
              onSkillEnabledChange={(skillId, enabled) => setDisabledSkillIds((current) => enabled ? current.filter((id) => id !== skillId) : current.includes(skillId) ? current : [...current, skillId])}
              onUse={createTask}
            />
          ) : null}
          {view === "settings" ? <SettingsSurface globalPolicy={globalPolicy} identities={identityList} proxies={proxyList} section={settingsSection} onGlobalPolicyChange={setGlobalPolicy} onProxiesChange={setProxyList} /> : null}
        </ThreadWorkspace>
      }
      right={view === "work" && workMode === "detail" ? <RightPanel><PrototypeArtifactPanel executionMode={selectedTaskExecutionModes.observe} executionSource={selectedTaskExecutionSources.observe} key={selectedTask.id} requestKey={resultPreviewRequestKey} run={previewRun} selection={previewSelection} tabHost={artifactTabHost} task={selectedTask} /></RightPanel> : null}
    />
  );
}

function isTextEditingTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && target.closest("input, textarea, select, [contenteditable='true']") != null;
}

function isActiveRunState(state: PrototypeRun["state"]) {
  return state === "running" || state === "waiting" || state === "checking" || state === "unknown";
}

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

function defaultIdentityPage(site: string) {
  if (site === "小红书") return "小红书发现页";
  if (site === "微信公众号") return "微信公众号首页";
  if (site === "抖音") return "抖音首页";
  if (site === "淘宝") return "淘宝首页";
  return `${site} 首页`;
}

function readTaskGrouping(): TaskGrouping {
  try {
    return window.localStorage.getItem(TASK_GROUPING_KEY) === "identity" ? "identity" : "skill";
  } catch {
    return "skill";
  }
}

function readTaskSort(): TaskSort {
  try {
    return window.localStorage.getItem(TASK_SORT_KEY) === "priority" ? "priority" : "recent";
  } catch {
    return "recent";
  }
}
