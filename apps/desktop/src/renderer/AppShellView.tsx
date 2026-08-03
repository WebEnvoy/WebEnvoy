import { ArrowLeft, ArrowRight, BriefcaseBusiness, CircleUserRound, Library, Settings } from "lucide-react";
import type { ReactNode } from "react";

import { CreateTaskShell } from "./CreateTaskShell";
import { IdentityEnvironmentsPage } from "./IdentityEnvironmentsPage";
import { OwnerState } from "./OwnerState";
import { RuntimeBlockedOwnerState, RuntimeCheckingOwnerState } from "./RuntimeOwnerState";
import { SettingsPage } from "./SettingsPage";
import { AppShell, LeftPanel, RightPanel, ThreadWorkspace } from "./shellPrimitives";
import { SiteSkillLibrary } from "./SiteSkillPages";
import { TaskThreadComposer } from "./TaskThreadComposer";
import { TaskThreadPage } from "./TaskThreadPage";
import { TaskThreadRightPanel } from "./TaskThreadRightPanel";
import { runtimeSupervisorIsChecking } from "./runtimeSupervisorState";
import { findCatalogSkillForTask, type AppController } from "./useAppController";
import { WorkbenchSidebar } from "./WorkbenchSidebar";

export function AppShellView({ controller }: { controller: AppController }) {
  const workDetail = controller.navigation.activeView === "work" && controller.navigation.workMode === "detail";
  return (
    <AppShell
      collapsePanelsOnNarrow
      initialRightOpen={false}
      rightPanelOpenRequestKey={controller.tasks.rightPanelOpenRequestKey}
      rightPanelStateKey={workDetail ? controller.tasks.selectedTask?.id : undefined}
      left={<AppSidebar controller={controller} />}
      header={(panelControls) => <AppHeader controller={controller} panelControls={panelControls} />}
      workspace={<AppWorkspace controller={controller} />}
      right={<AppRightPanel controller={controller} />}
    />
  );
}

function AppSidebar({ controller }: { controller: AppController }) {
  const { actions, navigation, tasks } = controller;
  return (
    <LeftPanel>
      <WorkbenchSidebar
        activeView={navigation.activeView}
        grouping={navigation.taskGrouping}
        selectedTaskId={navigation.activeView === "work" && navigation.workMode === "detail" ? tasks.selectedTask?.id ?? null : null}
        settingsTriggerRef={navigation.settingsTriggerRef}
        sort={navigation.taskSort}
        taskLoadStatus={tasks.effectiveCoreReadState.status}
        tasks={tasks.workbenchTaskThreads}
        onCreateTask={actions.createTask}
        onGroupingChange={navigation.setTaskGrouping}
        onOpenSettings={actions.openSettings}
        onOpenTask={actions.selectTask}
        onOpenView={actions.openView}
        onSortChange={navigation.setTaskSort}
      />
    </LeftPanel>
  );
}

function AppHeader({ controller, panelControls }: {
  controller: AppController;
  panelControls: { left: ReactNode; right: ReactNode; rightFullscreen: ReactNode };
}) {
  const { navigation, tasks } = controller;
  const settings = navigation.activeView === "settings";
  const workDetail = navigation.activeView === "work" && navigation.workMode === "detail" && tasks.selectedTask != null;
  const Icon = settings ? Settings : navigation.activeView === "browser" ? CircleUserRound : navigation.activeView === "library" ? Library : BriefcaseBusiness;
  return (
    <header className="shell-topbar production-topbar" aria-label="应用工具栏">
      <div className="topbar-left-slot">
        {panelControls.left}
        <button className="topbar-icon-button we-toolbar-icon-button cursor-interaction" type="button" aria-label="后退" disabled={!settings} onClick={navigation.closeSettings}><ArrowLeft size={15} /></button>
        <button className="topbar-icon-button we-toolbar-icon-button cursor-interaction" type="button" aria-label="前进" disabled><ArrowRight size={15} /></button>
      </div>
      <div className="topbar-center-surface"><span className="topbar-thread-symbol" aria-hidden="true"><Icon size={15} /></span><h2 id="thread-title">{pageTitle(controller)}</h2>{navigation.activeView === "browser" ? <div id="identity-topbar-actions" className="prototype-center-actions" /> : null}</div>
      <div className="topbar-right-slot production-right-topbar">
        {workDetail ? <><span className="right-panel-topbar-title">预览</span>{panelControls.rightFullscreen}{panelControls.right}</> : null}
      </div>
    </header>
  );
}

function AppWorkspace({ controller }: { controller: AppController }) {
  if (controller.navigation.activeView === "browser") return <IdentityWorkspace controller={controller} />;
  if (controller.navigation.activeView === "library") return <LibraryWorkspace controller={controller} />;
  if (controller.navigation.activeView === "settings") return <SettingsWorkspace controller={controller} />;
  return <WorkWorkspace controller={controller} />;
}

function IdentityWorkspace({ controller }: { controller: AppController }) {
  const { actions, sources, tasks } = controller;
  return (
    <ThreadWorkspace workspaceKey="browser">
      <IdentityEnvironmentsPage
        harborEndpoint={sources.connectionConfig.harborEndpoint}
        initialState={sources.harborIdentityState}
        recoveryRequest={controller.skillWorkbench.identityRecoveryRequest}
        runtimeSupervisorState={sources.runtimeSupervisorState}
        tasks={tasks.workbenchTaskThreads}
        onHarborStateChange={actions.onHarborStateChange}
        onOpenLibrary={() => actions.openView("library")}
        onOpenSettings={actions.openSettings}
      />
    </ThreadWorkspace>
  );
}

function LibraryWorkspace({ controller }: { controller: AppController }) {
  const { actions, skillWorkbench, sources } = controller;
  const catalog = sources.lodeCatalogState;
  if (catalog.status === "loading") return <ThreadWorkspace workspaceKey="library"><OwnerState title="正在读取站点技能" summary={catalog.summary} /></ThreadWorkspace>;
  if (catalog.status === "offline") return <ThreadWorkspace workspaceKey="library"><OwnerState title="站点技能暂不可用" summary={catalog.summary} onRecover={actions.openSettings} /></ThreadWorkspace>;
  return (
    <ThreadWorkspace workspaceKey="library">
      <SiteSkillLibrary
        catalog={catalog}
        compatibilityBySkill={skillWorkbench.compatibilityBySkill}
        identities={sources.harborIdentityState.identities}
        recoveryRequest={skillWorkbench.siteSkillRecoveryRequest}
        runtimeSupervisorState={sources.runtimeSupervisorState}
        onCreateIdentity={() => actions.openView("browser")}
        onNavigation={() => { skillWorkbench.invalidateRequests(); skillWorkbench.abandonSiteSkillRecovery(); }}
        onRecoveryConsumed={skillWorkbench.acknowledgeSiteSkillRecovery}
        onRecoverCandidate={skillWorkbench.recoverCandidate}
        onUse={skillWorkbench.useSiteSkill}
      />
    </ThreadWorkspace>
  );
}

function SettingsWorkspace({ controller }: { controller: AppController }) {
  const { navigation, sources } = controller;
  return (
    <ThreadWorkspace workspaceKey="settings">
      <SettingsPage
        embedded colorScheme={sources.shellContext?.colorScheme} configScope={sources.shellContext?.configScope}
        connectionConfig={sources.connectionConfig} platform={sources.shellContext?.platform}
        runtimeSupervisorState={sources.runtimeSupervisorState} settingsError={sources.settingsError} settingsSaved={sources.settingsSaved}
        onBack={navigation.closeSettings} onEndpointChange={controller.actions.updateEndpoint} onSave={sources.saveSettings}
      />
    </ThreadWorkspace>
  );
}

function WorkWorkspace({ controller }: { controller: AppController }) {
  const { navigation, skillWorkbench, sources } = controller;
  if (navigation.workMode === "create") {
    return (
      <ThreadWorkspace workspaceKey="work-create">
        <CreateTaskShell
          catalog={sources.lodeCatalogState} compatibilityBySkill={skillWorkbench.compatibilityBySkill}
          identities={sources.harborIdentityState.identities} selection={skillWorkbench.createTaskSelection}
          coreEndpoint={sources.connectionConfig.coreEndpoint} runtimeSupervisorState={sources.runtimeSupervisorState} onSelect={skillWorkbench.useSiteSkill}
          onCreateIdentity={() => controller.actions.openView("browser")} onCheckCompatibility={skillWorkbench.checkCreateTaskCompatibility}
          onRecover={controller.actions.openSettings} onRecoverCandidate={skillWorkbench.recoverCandidate}
          onRecoverRuntimeIdentity={skillWorkbench.recoverRuntimeIdentity}
          onRecoverRuntimeSkill={skillWorkbench.recoverRuntimeSkill}
          onRecoverExactTarget={skillWorkbench.recoverExactTarget} onTargetChange={skillWorkbench.resetTargetCompatibility}
          onTaskCreated={controller.actions.acceptCreatedTask}
        />
      </ThreadWorkspace>
    );
  }
  return <WorkDetail controller={controller} />;
}

function WorkDetail({ controller }: { controller: AppController }) {
  const { sources, tasks } = controller;
  const skill = tasks.selectedTask == null ? undefined : findCatalogSkillForTask(tasks.selectedTask, sources.lodeCatalogState.skills);
  if (tasks.selectedTask != null && tasks.selectedTask.runs.length === 0 && tasks.selectedSubmitTask != null) {
    return (
      <ThreadWorkspace workspaceKey={`work:${tasks.selectedTask.id}`} composer={
        <TaskThreadComposer
          key={tasks.selectedTask.id}
          coreEndpoint={sources.connectionConfig.coreEndpoint}
          harborIdentityState={sources.harborIdentityState}
          runtimeSupervisorState={sources.runtimeSupervisorState}
          selectedTask={tasks.selectedSubmitTask}
          skill={skill}
          onTask={tasks.acceptTaskThreadProjection}
        />
      }>
        <OwnerState title="暂无任务回合" summary="填写业务输入后即可提交第一个回合。" />
      </ThreadWorkspace>
    );
  }
  if (tasks.selectedTask == null || tasks.selectedRun == null || tasks.selectedSubmitTask == null) {
    if (tasks.effectiveCoreReadState.status !== "loading" && runtimeSupervisorIsChecking(sources.runtimeSupervisorState)) {
      return <ThreadWorkspace workspaceKey="work-empty"><RuntimeCheckingOwnerState /></ThreadWorkspace>;
    }
    if (tasks.effectiveCoreReadState.status !== "loading" && sources.runtimeSupervisorState.failClosed) {
      return (
        <ThreadWorkspace workspaceKey="work-empty">
          <RuntimeBlockedOwnerState
            runtime={sources.runtimeSupervisorState}
            onOpenBrowser={() => controller.actions.openView("browser")}
            onOpenSettings={controller.actions.openSettings}
          />
        </ThreadWorkspace>
      );
    }
    return <ThreadWorkspace workspaceKey="work-empty"><OwnerState title={emptyTitle(tasks.effectiveCoreReadState.status)} summary={emptySummary(tasks.effectiveCoreReadState.status, tasks.effectiveCoreReadState.summary)} onRecover={tasks.effectiveCoreReadState.status === "loading" ? undefined : controller.actions.openSettings} /></ThreadWorkspace>;
  }
  return (
    <ThreadWorkspace workspaceKey={`work:${tasks.selectedTask.id}`} composer={
      <TaskThreadComposer
        key={tasks.selectedTask.id}
        coreEndpoint={sources.connectionConfig.coreEndpoint} harborIdentityState={sources.harborIdentityState}
        runtimeSupervisorState={sources.runtimeSupervisorState} selectedTask={tasks.selectedSubmitTask}
        skill={skill} onTask={tasks.acceptTaskThreadProjection}
      />
    }>
      <TaskThreadPage
        coreEndpoint={sources.connectionConfig.coreEndpoint}
        navigationItems={tasks.threadNavigationItems}
        selectedRun={tasks.selectedRun} selectedTask={tasks.selectedTask} onActiveRunChange={tasks.setSelectedRunId}
        skill={skill} skills={sources.lodeCatalogState.skills} onOpenPreview={tasks.requestRightPanel}
      />
    </ThreadWorkspace>
  );
}

function AppRightPanel({ controller }: { controller: AppController }) {
  const { navigation, sources, tasks } = controller;
  if (navigation.activeView !== "work" || navigation.workMode !== "detail" || tasks.selectedTask == null || tasks.previewRun == null || tasks.previewSelection == null) return null;
  return (
    <RightPanel>
      <TaskThreadRightPanel
        coreEndpoint={sources.connectionConfig.coreEndpoint}
        coreReadState={tasks.effectiveCoreReadState} coreSubmitState={tasks.coreSubmitState}
        runtimeSupervisorState={sources.runtimeSupervisorState} selectedRun={tasks.previewRun} selectedTask={tasks.selectedTask}
        previewSelection={tasks.previewSelection} skills={sources.lodeCatalogState.skills}
        onReadDetail={controller.actions.openResultDetail}
        shellDiagnostics={{ colorScheme: sources.shellContext?.colorScheme, configScope: sources.shellContext?.configScope, platform: sources.shellContext?.platform }}
      />
    </RightPanel>
  );
}

function pageTitle(controller: AppController) {
  const { activeView, workMode } = controller.navigation;
  if (activeView === "settings") return "设置";
  if (activeView === "browser") return "账号身份";
  if (activeView === "library") return "站点技能";
  return workMode === "create" ? "创建任务" : controller.tasks.selectedTask?.title ?? "任务";
}

function emptyTitle(status: string) {
  return status === "loading" ? "正在读取任务" : status === "ready" ? "暂无任务线程" : "任务暂不可用";
}

function emptySummary(status: string, summary: string) {
  return status === "loading" ? summary : status === "ready" ? "当前没有任务线程。" : "暂时无法读取任务线程，请检查连接后重试。";
}
