import { BriefcaseBusiness } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import { fetchPendingAuthorizationDecision } from "../../src/renderer/authorizationDecisionClient";
import { initialCoreTaskSubmitState } from "../../src/renderer/coreTaskSubmitClient";
import { fetchCoreRunResult } from "../../src/renderer/coreRunResultClient";
import type { LodeCatalogSkill } from "../../src/renderer/lodeCatalogClient";
import { OwnerState } from "../../src/renderer/OwnerState";
import {
  fetchCoreThreadState,
  retainLastKnownCoreThreads,
  unavailableCoreThreadState,
} from "../../src/renderer/coreThreadClient";
import {
  projectRuntimeGatedTasks,
  runtimeSupervisorUnavailableState,
} from "../../src/renderer/runtimeSupervisorState";
import {
  AppShell,
  LeftPanel,
  RightPanel,
  ThreadWorkspace,
} from "../../src/renderer/shellPrimitives";
import { SingleActionConfirmation, TaskThreadPage } from "../../src/renderer/TaskThreadPage";
import { projectBusinessResultMessage, projectStandardBusinessResult } from "../../src/renderer/TaskBusinessResult";
import { TaskThreadRightPanel } from "../../src/renderer/TaskThreadRightPanel";
import type { ThreadNavigationItem } from "../../src/renderer/ThreadNavigationRail";
import type { TaskPreviewSelection } from "../../src/renderer/useAppTasks";
import { WorkbenchSidebar } from "../../src/renderer/WorkbenchSidebar";
import "../../src/renderer/uiFoundation.css";
import "../../src/renderer/styles.css";
import "../../src/renderer/workbench.css";

const coreEndpoint = "http://core.owner";
const taskAId = "thread_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const taskBId = "thread_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const emptyTaskId = "thread_cccccccccccccccccccccccccccccccc";
const consumerBoundary = "Core stores bounded field summaries and owner refs only; raw content remains with its owner.";
const authorizationDecisionRef = "authorization-decision:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const authorizationRequests: WebEnvoyOwnerApiJsonRequest[] = [];
let singleActionAttempts = 0;
let createTaskSelection: TaskProjection | undefined;
let selectedResultDetailRef: string | undefined;
const nestedDetailRefs = Array.from({ length: 15 }, (_, index) =>
  index === 0
    ? "detail_ref_ff55d94a-9558-4777-9624-e138ed2a76d8"
    : `detail_ref_00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
);
const nestedSearchItems = nestedDetailRefs.map((detailRef, index) => ({
  detail_ref: detailRef,
  title: index === 0 ? "让 AI 自动整理资料的 5 个方法" : `公开笔记 ${index + 1}`,
  author_display_name: index === 0 ? "一只产品汪" : `公开作者 ${index + 1}`,
  interaction_metrics: { likes: String(2481 - index), comments: String(80 - index), collects: String(320 - index) },
}));
const resultSkills = [{
  outputKind: "collection",
  outputSchemaId: "lode://schema/site-capability/xiaohongshu/search-notes/output@0.1.0",
  packageRef: "lode://site-capability/xiaohongshu/search-notes@0.1.0",
  version: "0.1.0",
  lockRef: "lode://lock/site-capability/xiaohongshu/search-notes@0.1.0",
}, {
  outputKind: "object",
  outputSchemaId: "lode://schema/site-capability/xiaohongshu/read-note-detail/output@0.1.0",
  packageRef: "lode://site-capability/xiaohongshu/read-note-detail@0.1.0",
  version: "0.1.0",
  lockRef: "lode://lock/site-capability/xiaohongshu/read-note-detail@0.1.0",
}, {
  outputKind: "object",
  outputSchemaId: "lode://schema/site-capability/boss/job-search/output@0.1.0",
  packageRef: "lode://site-capability/boss/job-search@0.1.0",
  version: "0.1.0",
  lockRef: "lode://lock/site-capability/boss/job-search@0.1.0",
}] as LodeCatalogSkill[];
const ownerPayload = {
  ok: true,
  threads: [
    {
      schema_version: "webenvoy.task-thread.v0",
      thread_id: taskAId,
      capability_ref: "lode:capability/search-notes",
      identity_environment_ref: "identity-env:xhs-ops-a",
      created_at: "2026-07-20T08:00:00Z",
      updated_at: "2026-07-20T09:10:00Z",
      turns: [
        {
          turn_id: "turn_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1",
          sequence: 1,
          idempotency_key: "owner-a-turn-1",
          run_id: "run-owner-a-completed",
          creation_channel: "api",
          input: {
            schema_version: "webenvoy.task-turn-input.v0",
            fields: [{ field_id: "keyword", kind: "scalar", summary: "AI 工具" }],
            attachment_refs: [],
            consumer_boundary: consumerBoundary,
          },
          created_at: "2026-07-20T08:00:00Z",
          updated_at: "2026-07-20T08:01:00Z",
          terminal_at: "2026-07-20T08:01:00Z",
          submission_state: "accepted",
          status: "completed",
        },
        {
          turn_id: "turn_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa2",
          sequence: 2,
          idempotency_key: "owner-a-turn-2",
          run_id: "run-owner-a-running",
          creation_channel: "app",
          input: {
            schema_version: "webenvoy.task-turn-input.v0",
            fields: [{ field_id: "keyword", kind: "scalar", summary: "AI 工作台" }],
            attachment_refs: [],
            consumer_boundary: consumerBoundary,
          },
          created_at: "2026-07-20T09:00:00Z",
          updated_at: "2026-07-20T09:10:00Z",
          submission_state: "accepted",
          status: "running",
        },
        {
          turn_id: "turn_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa3",
          sequence: 3,
          idempotency_key: "owner-a-turn-3",
          run_id: "run-owner-a-empty-result",
          creation_channel: "app",
          input: {
            schema_version: "webenvoy.task-turn-input.v0",
            fields: [{ field_id: "keyword", kind: "scalar", summary: "不存在的关键词" }],
            attachment_refs: [],
            consumer_boundary: consumerBoundary,
          },
          created_at: "2026-07-20T09:20:00Z",
          updated_at: "2026-07-20T09:20:26Z",
          terminal_at: "2026-07-20T09:20:26Z",
          submission_state: "accepted",
          failure_code: "empty_result",
          submission_error: {
            category: "result_projection",
            code: "empty_result",
            phase: "projection",
            recovery_hint: "fix_input",
          },
          status: "failed",
          run_status: "failed",
        },
      ],
    },
    {
      schema_version: "webenvoy.task-thread.v0",
      thread_id: taskBId,
      capability_ref: "lode:capability/job-search",
      identity_environment_ref: "identity-env:recruiting-a",
      created_at: "2026-07-20T07:00:00Z",
      updated_at: "2026-07-20T08:30:00Z",
      turns: Array.from({ length: 4 }, (_, index) => {
        const sequence = index + 1;
        const hour = String(6 + sequence).padStart(2, "0");
        return {
          turn_id: `turn_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb${sequence}`,
          sequence,
          idempotency_key: `owner-b-turn-${sequence}`,
          run_id: sequence === 1 ? "run-owner-b-completed" : `run-owner-b-completed-${sequence}`,
          creation_channel: sequence === 1 ? "sdk" : "app",
          input: {
            schema_version: "webenvoy.task-turn-input.v0",
            fields: [{
              field_id: "keyword",
              kind: "scalar",
              summary: sequence === 1 ? "产品经理" : `产品经理 ${sequence}`,
            }],
            attachment_refs: [],
            consumer_boundary: consumerBoundary,
          },
          created_at: `2026-07-20T${hour}:00:00Z`,
          updated_at: `2026-07-20T${hour}:01:00Z`,
          terminal_at: `2026-07-20T${hour}:01:00Z`,
          submission_state: "accepted",
          status: "completed",
        };
      }),
    },
    {
      schema_version: "webenvoy.task-thread.v0",
      thread_id: emptyTaskId,
      capability_ref: "lode:capability/custom-owner-skill",
      identity_environment_ref: "identity-env:empty-owner",
      created_at: "2026-07-20T06:00:00Z",
      updated_at: "2026-07-20T06:00:00Z",
      turns: [],
    },
  ],
};

window.localStorage.setItem("webenvoy.shell.v3.left-panel-width", "broken");
window.localStorage.setItem("webenvoy.shell.v3.right-panel-width", "broken");
window.localStorage.setItem("webenvoy.shell.v3.right-panel-ratio", "broken");
window.localStorage.setItem(`webenvoy.shell.v3.right-panel-open:${taskAId}`, "broken");
window.webenvoyShell = {
  getShellContext: async () => ({
    platform: "darwin",
    colorScheme: "light",
    configScope: "local-ui-only",
  }),
  requestOwnerJson: async (request) => {
    authorizationRequests.push(request);
    if (/^\/runs\/[^/]+\/result$/.test(request.path)) {
      const runId = decodeURIComponent(request.path.split("/")[2] ?? "");
      if (runId === "run-owner-unavailable") return { ok: false, error: "owner unavailable" };
      if (runId === "run-owner-a-empty-result") return { ok: true, body: { ok: true, result: {
        schema_version: "webenvoy.result-query.v0",
        run_id: runId,
        status: "failed",
        terminal: true,
        result: {
          envelope_state: "available",
          payload_state: "not_persisted_in_core",
          result_envelope: {
            schema_version: "webenvoy.result-envelope.v0",
            run_record_ref: runId,
            ok: false,
            outcome: "failed",
            terminal: true,
            capability_ref: "lode:capability/search-notes",
            capability_version: "0.1.0",
            capability_lock_ref: "lode://lock/site-capability/xiaohongshu/search-notes@0.1.0",
            package_ref: "lode://site-capability/xiaohongshu/search-notes@0.1.0",
            failure: {
              category: "result_projection",
              code: "empty_result",
              phase: "projection",
              recovery_hint: "fix_input",
            },
          },
        },
        failure: {
          category: "result_projection",
          code: "empty_result",
          phase: "projection",
          recovery_hint: "fix_input",
        },
        evidence_refs: [],
      } } };
      if (runId === "run-owner-detail-read-result") return { ok: true, body: { ok: true, result: {
        schema_version: "webenvoy.result-query.v0",
        run_id: runId,
        status: "succeeded",
        terminal: true,
        result: {
          envelope_state: "available",
          payload_state: "available",
          result_ref: `result:core/${runId}`,
          result_envelope: {
            schema_version: "webenvoy.result-envelope.v0",
            run_record_ref: runId,
            ok: true,
            outcome: "success",
            terminal: true,
            capability_ref: "lode:capability/read-note-detail",
            capability_version: "0.1.0",
            capability_lock_ref: "lode://lock/site-capability/xiaohongshu/read-note-detail@0.1.0",
            package_ref: "lode://site-capability/xiaohongshu/read-note-detail@0.1.0",
            result_kind: "read-note-detail.read_result",
            output_schema_id: "lode://schema/site-capability/xiaohongshu/read-note-detail/output@0.1.0",
            data: {
              projection: {
                normalized: {
                  public_summary: {
                    normalized: {
                      kind: "xiaohongshu_note_detail",
                      title: "杭州最美轻徒步路线Top10，请收好！",
                      source_citation: {
                        kind: "xhs_note_detail_ref",
                        note_id: "6a0d5c0c0000000008000fa2",
                        url: "https://www.xiaohongshu.com/explore/6a0d5c0c0000000008000fa2",
                        field_sources: ["pinia_store_summary", "network_summary"],
                      },
                    },
                  },
                },
              },
            },
          },
        },
        evidence_refs: [],
      } } };
      if (runId === "run-owner-nested-read-result" || runId === "run-owner-a-completed") return { ok: true, body: { ok: true, result: {
        schema_version: "webenvoy.result-query.v0",
        run_id: runId,
        status: "succeeded",
        terminal: true,
        result: {
          envelope_state: "available",
          payload_state: "available",
          result_ref: `result:core/${runId}`,
          result_envelope: {
            schema_version: "webenvoy.result-envelope.v0",
            run_record_ref: runId,
            ok: true,
            outcome: "success",
            terminal: true,
            capability_ref: "lode:capability/search-notes",
            capability_version: "0.1.0",
            capability_lock_ref: "lode://lock/site-capability/xiaohongshu/search-notes@0.1.0",
            package_ref: "lode://site-capability/xiaohongshu/search-notes@0.1.0",
            result_kind: "xhs_note_search",
            output_schema_id: "lode://schema/site-capability/xiaohongshu/search-notes/output@0.1.0",
            projection_ref: "read_result_4bd7acd8-99eb-439d-bec7-ffc18b3d42b8",
            data: {
              projection: {
                result_kind: "xhs_note_search",
                status: "available",
                classification: "success_result",
                normalized: {
                  schema_version: "webenvoy.core-harbor-read-operation-projection.v0",
                  public_summary: {
                    schema_version: runId === "run-owner-nested-read-result"
                      ? "harbor-read-operation-public-summary/v0"
                      : "harbor-read-operation-public-summary/v1",
                    operation_id: "xhs_search_notes",
                    result_kind: "xiaohongshu_search_notes_surface",
                    surface: "search_result",
                    result_state: "operation_read_response_observed",
                    response_status: 200,
                    result_count: 15,
                    detail_refs: nestedDetailRefs,
                    ...(runId === "run-owner-nested-read-result" ? {} : { items: nestedSearchItems }),
                    source_signals: ["pinia_store", "xhs_search_read_network"],
                  },
                  operation_ref: "read_operation_406187891879d3a4128ef8e7f0a036eb",
                  public_summary_ref: "read_result_4bd7acd8-99eb-439d-bec7-ffc18b3d42b8",
                },
                source_refs: ["read_source_406187891879d3a4128ef8e7f0a036eb"],
                evidence_refs: ["screenshot_5b809153-693d-43e9-ab8f-3edbada20214"],
              },
            },
          },
        },
        evidence_refs: [],
      } } };
      const job = runId.startsWith("run-owner-b-completed");
      return { ok: true, body: { ok: true, result: {
        schema_version: "webenvoy.result-query.v0",
        run_id: runId,
        status: "succeeded",
        terminal: true,
        result: {
          envelope_state: "available",
          payload_state: runId === "run-result-ref-missing" ? "unavailable" : runId === "run-contradictory" || runId === "run-not-persisted" ? "not_persisted_in_core" : "available",
          ...(runId === "run-result-ref-missing" ? { unavailable_reason: "result_ref_missing" } : {}),
          ...(runId === "run-result-ref-missing" ? {} : { result_ref: `result:core/${runId}` }),
          result_envelope: {
            schema_version: "webenvoy.result-envelope.v0",
            run_record_ref: runId,
            ok: true,
            outcome: "success",
            terminal: true,
            capability_ref: job ? "lode:capability/job-search" : "lode:capability/search-notes",
            capability_version: "0.1.0",
            capability_lock_ref: job ? "lode://lock/site-capability/boss/job-search@0.1.0" : "lode://lock/site-capability/xiaohongshu/search-notes@0.1.0",
            package_ref: job ? "lode://site-capability/boss/job-search@0.1.0" : "lode://site-capability/xiaohongshu/search-notes@0.1.0",
            result_kind: job ? "boss_job_detail" : "xhs_note_search",
            output_schema_id: job ? "lode://schema/site-capability/boss/job-search/output@0.1.0" : "lode://schema/site-capability/xiaohongshu/search-notes/output@0.1.0",
            ...(runId === "run-not-persisted" || runId === "run-result-ref-missing" ? {} : { data: runId.startsWith("run-forbidden") ? { [runId.replace("run-forbidden-", "") || "cookie"]: "private" } : runId === "run-contradictory" ? { title: "not allowed" } : job ? { title: "产品经理", company: "WebEnvoy", city: "上海" } : {
              status: "available",
              normalized: { result_count: 8, notes: Array.from({ length: 8 }, (_, index) => ({
                title: `AI 工具笔记 ${index + 1}`,
                author: `作者 ${index + 1}`,
                interactions: 100 + index,
                readAt: "今天 14:28",
              })) },
            } }),
          },
        },
        evidence_refs: [],
      } } };
    }
    if (request.path === `/authorization-decisions/${encodeURIComponent(authorizationDecisionRef)}`) {
      return { ok: true, body: { ok: true, authorization_decision: {
        schema_version: "webenvoy.authorization-decision.v0",
        decision_ref: authorizationDecisionRef,
        business_action: {
          action_instance_ref: "action-instance:xhs-search",
          action_id: "xhs_search_notes",
          category: "read",
          target: { target_ref: "target:xhs-search-results", target_type: "search_results_page", site_slug: "xiaohongshu", origin: "https://www.xiaohongshu.com" },
        },
        owner_declaration: {
          matcher: "lode_action_declaration",
          declaration_ref: "lode:action/xhs_search_notes",
          declaration_version: "0.1.0",
          resource_match_ref: "lode:resource/xhs_search_notes",
          resource_match_version: "0.1.0",
        },
        effective_policy: { mode: "confirm", source: "installed_skill_user_version", source_version: "1" },
        applicability: { scope: "task", run_id: "run-owner-a-confirming", thread_id: taskAId, turn_id: "turn_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa3", config_refs: ["execution-policy:skill/xhs"] },
        outcome: "confirm",
        risk_marker: null,
        decided_at: "2026-07-20T08:00:00Z",
        expires_at: "2099-07-20T08:05:00Z",
        state: "active",
        invalidated_at: null,
        invalidation_reason: null,
        consumer_boundary: "Business policy decision summary only; technical trace and private browser, evidence, and content material are excluded.",
      } } };
    }
    if (request.path === `/authorization-decisions/${encodeURIComponent(authorizationDecisionRef)}/single-action`) {
      singleActionAttempts += 1;
      if (singleActionAttempts === 1) return { ok: false, error: "simulated_single_action_response_loss" };
      return { ok: true, body: { ok: true, single_action_decision: {
        schema_version: "webenvoy.single-action-decision.v0",
        confirmation_decision_ref: authorizationDecisionRef,
        mode: "deny",
      } } };
    }
    return { ok: true, body: ownerPayload };
  },
};

const ownerState = await fetchCoreThreadState(coreEndpoint);
const authorizationBinding = {
  decisionRef: authorizationDecisionRef,
  runId: "run-owner-a-confirming",
  threadId: taskAId,
  turnId: "turn_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa3",
};
const authorizationProbe = await fetchPendingAuthorizationDecision(coreEndpoint, authorizationBinding);
if (!authorizationProbe.ok) throw new Error(`Authorization decision fixture was rejected: ${authorizationProbe.reason}`);
const retainedState = retainLastKnownCoreThreads(
  ownerState,
  unavailableCoreThreadState(coreEndpoint, "Core runtime disconnected."),
);
const runtimeState = runtimeSupervisorUnavailableState("Core and Harbor runtime unavailable.");
const tasks = projectRuntimeGatedTasks(
  retainedState.tasks,
  runtimeState,
  retainedState.liveTaskIds,
);

function WorkbenchDomHarness() {
  const [selectedTaskId, setSelectedTaskId] = useState(tasks[0]?.id ?? "");
  const [selectedRunIds, setSelectedRunIds] = useState<Record<string, string>>({});
  const [previewSelections, setPreviewSelections] = useState<Record<string, TaskPreviewSelection>>({});
  const [rightPanelOpenRequestKey, setRightPanelOpenRequestKey] = useState<number>();
  const settingsTriggerRef = useRef<HTMLButtonElement>(null);
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? tasks[0];
  const selectedRunId = selectedTask ? selectedRunIds[selectedTask.id] : undefined;
  const selectedRun = selectedTask?.runs.find(
    (run) => run.id === selectedRunId,
  ) ?? selectedTask?.runs.find((run) => run.lifecycle === "completed") ?? selectedTask?.runs[0];
  const displayedTask = selectedTask;
  const displayedRun = displayedTask?.runs.find((run) => run.id === selectedRun?.id);
  const previewSelection = selectedTask == null ? undefined : previewSelections[selectedTask.id];
  const previewRun = previewSelection == null ? undefined : selectedTask?.runs.find((run) => run.id === previewSelection.runId);
  const confirmationRun = selectedTask.id === taskAId && displayedRun != null ? {
    ...displayedRun,
    id: authorizationBinding.runId,
    turnId: authorizationBinding.turnId,
    turnStatus: "waiting_for_user" as const,
    authorizationDecisionRefs: [authorizationDecisionRef],
  } : null;
  const navigationItems = useMemo<ThreadNavigationItem[]>(
    () => selectedTask?.runs.map((run) => ({
      id: run.id,
      hasOutput: run.evidenceCards.length > 0,
      getLabel: () => run.label,
      getPreview: () => ({ response: run.summary, outputs: [] }),
    })) ?? [],
    [selectedTask],
  );

  if (!selectedTask) return null;

  return (
    <AppShell
      collapsePanelsOnNarrow
      initialRightOpen={false}
      rightPanelOpenRequestKey={rightPanelOpenRequestKey}
      rightPanelStateKey={selectedTask.id}
      left={
        <LeftPanel>
          <WorkbenchSidebar
            activeView="work"
            grouping="skill"
            selectedTaskId={selectedTask.id}
            settingsTriggerRef={settingsTriggerRef}
            sort="recent"
            taskLoadStatus={retainedState.status}
            tasks={tasks}
            onGroupingChange={() => {}}
            onCreateTask={(task) => { createTaskSelection = task; }}
            onOpenSettings={() => {}}
            onOpenTask={(task) => setSelectedTaskId(task.id)}
            onOpenView={() => {}}
            onSortChange={() => {}}
          />
        </LeftPanel>
      }
      header={(panelControls) => (
        <header className="shell-topbar production-topbar" aria-label="应用工具栏">
          <div className="topbar-left-slot">{panelControls.left}</div>
          <div className="topbar-center-surface">
            <BriefcaseBusiness size={15} />
            <h2>任务线程</h2>
          </div>
          <div className="topbar-right-slot production-right-topbar">
            <span className="right-panel-topbar-title">预览</span>
            {panelControls.rightFullscreen}
            {panelControls.right}
          </div>
        </header>
      )}
      workspace={displayedRun ? (
        <ThreadWorkspace workspaceKey={`work:${selectedTask.id}`}>
          <TaskThreadPage
            coreEndpoint={coreEndpoint}
            navigationItems={navigationItems}
            selectedRun={displayedRun}
            selectedTask={displayedTask}
            skills={resultSkills}
            onActiveRunChange={(runId) => setSelectedRunIds((current) => ({
              ...current,
              [selectedTask.id]: runId,
            }))}
            onOpenPreview={(selection) => {
              setPreviewSelections((current) => ({ ...current, [selectedTask.id]: selection }));
              setRightPanelOpenRequestKey((key) => (key ?? 0) + 1);
            }}
          />
          {confirmationRun == null ? null : (
            <SingleActionConfirmation
              endpoint={coreEndpoint}
              identityLabel={selectedTask.accountIdentity}
              run={confirmationRun}
              threadRef={selectedTask.id}
            />
          )}
        </ThreadWorkspace>
      ) : (
        <ThreadWorkspace workspaceKey={`work:${selectedTask.id}`}>
          <OwnerState title="暂无任务回合" summary="该线程已创建，尚未提交业务输入。" />
        </ThreadWorkspace>
      )}
      right={previewRun && previewSelection ? (
        <RightPanel>
          <TaskThreadRightPanel
            coreEndpoint={coreEndpoint}
            coreReadState={retainedState}
            coreSubmitState={initialCoreTaskSubmitState}
            runtimeSupervisorState={runtimeState}
            previewSelection={previewSelection}
            selectedRun={previewRun}
            selectedTask={displayedTask}
            skills={resultSkills}
            onReadDetail={(detailRef) => { selectedResultDetailRef = detailRef; return true; }}
            shellDiagnostics={{ colorScheme: "light", configScope: "local-ui-only", platform: "darwin" }}
          />
        </RightPanel>
      ) : undefined}
    />
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(<WorkbenchDomHarness />);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const waitFor = async (predicate: () => boolean, message: string) => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(message);
};
const shell = () => document.querySelector<HTMLElement>(".app-shell");
const rightPanel = () => document.querySelector<HTMLElement>('[data-focus-area="right-panel"]');
const previewButton = () => document.querySelector<HTMLButtonElement>('[data-workbench-open-right]');
const taskButton = (taskId: string) => Array.from(
  document.querySelectorAll<HTMLButtonElement>(".task-thread-row"),
).find((button) => selectedTaskIdFromButton(button) === taskId);
const selectedTaskIdFromButton = (button: HTMLButtonElement) =>
  button.textContent?.includes("xhs-ops-a")
    ? taskAId
    : button.textContent?.includes("recruiting-a")
      ? taskBId
      : emptyTaskId;

async function runDesktopChecks() {
  await waitFor(() => Boolean(shell() && previewButton()), "Workbench did not render.");
  const appShell = shell();
  assert(appShell, "AppShell is missing.");
  assert(ownerState.status === "ready" && ownerState.tasks.length === 3, "Owner threads were not projected.");
  assert(retainedState.status === "offline" && retainedState.tasks.length === 3, "Last owner state was not retained.");
  assert(taskButton(emptyTaskId), "Empty owner thread was not rendered safely in the sidebar.");
  const taskA = tasks.find((task) => task.id === taskAId);
  assert(taskA, "Projected owner task A is missing.");
  const resultRun = taskA.runs.find((run) => run.id === "run-owner-a-completed");
  assert(resultRun, "Completed owner run is missing for the result matrix.");
  const matrix = [
    resultModel(resultRun, "collection", { normalized: { notes: [{ title: "A" }], result_count: 1 } }, "search_results"),
    resultModel(resultRun, "object", { title: "A" }, "content_detail"),
    resultModel(resultRun, "images", { normalized: { images: [{ name: "cover.png", size: "2 MB" }] } }, "image_gallery"),
    resultModel(resultRun, "media", { normalized: { media: [{ name: "clip.mp4", duration: "10 秒" }] } }, "video_collection"),
    resultModel(resultRun, "files", { normalized: { files: [{ name: "report.pdf", size: "1 MB" }] } }, "file_collection"),
    projectStandardBusinessResult({ ...resultRun, resultRows: [] }, readyResult(undefined, "unknown_owner_type")),
  ].map((model) => model.kind);
  assert(matrix.join(",") === "collection,object,images,media,files,generic", "Standard result type matrix is incomplete.");
  const unboundResult = projectStandardBusinessResult(
    resultRun,
    readyResult({ normalized: { notes: [{ title: "A" }] } }, "search_results"),
  );
  assert(unboundResult.kind === "generic", "A result without an exact package/version/lock/schema binding used a specialized renderer.");
  const stateTitles = [
    projectBusinessResultMessage({ ...resultRun, turnStatus: "cancelled" }, { status: "fixture" })?.title,
    projectBusinessResultMessage({ ...resultRun, turnStatus: "status_unknown" }, { status: "fixture" })?.title,
    projectBusinessResultMessage(resultRun, { status: "unavailable", reason: "owner", summary: "owner unavailable" })?.title,
    projectBusinessResultMessage({ ...resultRun, outcome: "failure", lifecycle: "blocked" }, readyFailure("runtime_timeout"))?.title,
    projectBusinessResultMessage(resultRun, readyUnavailableResult("result_ref_missing"))?.title,
    projectBusinessResultMessage(resultRun, readyUnavailableResult("projection_unavailable"))?.title,
    projectBusinessResultMessage(resultRun, readyPayloadState("not_persisted_in_core"))?.title,
  ];
  assert(stateTitles.join(",") === "已取消,执行状态待确认,结果暂不可用,执行超时,结果引用缺失,结果不可读取,结果内容暂不可用", "Terminal result states are not distinct.");
  const forbiddenRuns = ["cookie", "access_token", "sessionToken", "Authorization", "password", "secret", "api_key", "access_key", "private_key", "encryption_key"];
  const [forbiddenResults, contradictoryResult, notPersistedResult, unavailableResult, missingRefResult, nestedReadResult, publicReadResult, detailReadResult] = await Promise.all([
    Promise.all(forbiddenRuns.map((field) => fetchCoreRunResult(coreEndpoint, `run-forbidden-${field}`))),
    fetchCoreRunResult(coreEndpoint, "run-contradictory"),
    fetchCoreRunResult(coreEndpoint, "run-not-persisted"),
    fetchCoreRunResult(coreEndpoint, "run-owner-unavailable"),
    fetchCoreRunResult(coreEndpoint, "run-result-ref-missing"),
    fetchCoreRunResult(coreEndpoint, "run-owner-nested-read-result"),
    fetchCoreRunResult(coreEndpoint, "run-owner-a-completed"),
    fetchCoreRunResult(coreEndpoint, "run-owner-detail-read-result"),
  ]);
  assert(forbiddenResults.every((result) => result.status === "unavailable" && result.reason === "invalid") &&
    contradictoryResult.status === "unavailable" && contradictoryResult.reason === "invalid" &&
    notPersistedResult.status === "ready" && notPersistedResult.result.data == null && unavailableResult.status === "unavailable" && unavailableResult.reason === "owner" &&
    missingRefResult.status === "ready" && missingRefResult.result.unavailableReason === "result_ref_missing",
    "Core result client did not fail closed for unsafe or unavailable owner payloads.");
  assert(
    nestedReadResult.status === "ready" &&
      nestedReadResult.result.projectionRef === "read_result_4bd7acd8-99eb-439d-bec7-ffc18b3d42b8",
    "A valid nested Core owner result was rejected as fixture data.",
  );
  assert(detailReadResult.status === "ready", "A valid nested Core detail result exceeded the owner inspection depth.");
  const detailReadModel = projectStandardBusinessResult(resultRun, detailReadResult, resultSkills);
  assert(
    detailReadModel.kind === "object" &&
      detailReadModel.fields.some((field) => field.label === "title" && field.value === "杭州最美轻徒步路线Top10，请收好！"),
    "A nested Core detail result did not render its public business fields.",
  );
  assert(nestedReadResult.status === "ready", "The nested Core owner result is unavailable for projection checks.");
  const nestedReadModel = projectStandardBusinessResult(resultRun, nestedReadResult, resultSkills);
  assert(
    nestedReadModel.kind === "object" &&
      nestedReadModel.fields.some((field) => field.label === "历史结果" && field.value.includes("无法恢复标题")),
    "A v0 nested read projection was presented as current structured business data.",
  );
  assert(publicReadResult.status === "ready", "The v1 Core search result is unavailable for projection checks.");
  const publicReadModel = projectStandardBusinessResult(resultRun, publicReadResult, resultSkills);
  assert(
    publicReadModel.kind === "collection" &&
      publicReadModel.total === 15 &&
      publicReadModel.rows[0]?.id === nestedDetailRefs[0] &&
      publicReadModel.rows[0]?.cells["标题"] === "让 AI 自动整理资料的 5 个方法" &&
      publicReadModel.rows[0]?.cells["作者"] === "一只产品汪" &&
      publicReadModel.rows[0]?.cells["互动"] === "赞 2481 · 评论 80 · 收藏 320",
    "A v1 nested read projection did not render the public search card while preserving its hidden detail ref.",
  );
  const validSummary = {
    schema_version: "harbor-read-operation-public-summary/v1",
    operation_id: "xhs_search_notes",
    result_kind: "xiaohongshu_search_notes_surface",
    surface: "search_result",
    result_count: 2,
    detail_refs: nestedDetailRefs.slice(0, 2),
    items: nestedSearchItems.slice(0, 2),
  };
  const { schema_version: _missingVersion, ...missingVersion } = validSummary;
  const { items: _v0Items, ...validV0Summary } = validSummary;
  const invalidSummaries = [
    { ...validSummary, schema_version: "harbor-read-operation-public-summary/v2" },
    missingVersion,
    { ...validSummary, schema_version: "harbor-read-operation-public-summary/v0" },
    { ...validV0Summary, schema_version: "harbor-read-operation-public-summary/v0", result_count: 1 },
    { ...validSummary, items: [...validSummary.items].reverse() },
    { ...validSummary, detail_refs: [nestedDetailRefs[0], nestedDetailRefs[0]] },
    { ...validSummary, detail_refs: ["not-an-opaque-ref", nestedDetailRefs[1]] },
    { ...validSummary, items: [{ ...validSummary.items[0], interaction_metrics: { likes: 10 } }, validSummary.items[1]] },
  ];
  assert(invalidSummaries.every((summary) => {
    const model = projectStandardBusinessResult(resultRun, readyXhsSearchResult(summary), resultSkills);
    return model.kind === "object" && model.fields.some((field) => field.label === "结果不可用");
  }), "Unknown, damaged, reordered, duplicate, or non-public XHS search summaries did not fail closed.");
  const bossModel = projectStandardBusinessResult(resultRun, {
    status: "ready",
    result: {
      outcome: "success",
      resultKind: "object",
      outputSchemaId: "lode://schema/site-capability/boss/job-search/output@0.1.0",
      packageRef: "lode://site-capability/boss/job-search@0.1.0",
      capabilityVersion: "0.1.0",
      capabilityLockRef: "lode://lock/site-capability/boss/job-search@0.1.0",
      data: { jobs: [{ title: "AI 工程师" }] },
      payloadState: "available",
      envelopeState: "available",
    },
  }, resultSkills);
  assert(bossModel.kind === "collection" && bossModel.rows[0]?.cells.title === "AI 工程师",
    "A BOSS result was incorrectly routed through the Xiaohongshu search-card renderer.");
  assert(taskA.runs.some((run) => run.id === "run-owner-a-completed"), "Completed owner turn was not retained.");
  assert(taskA.runs.some((run) => run.id === `runtime-blocked-${taskAId}`), "Active owner turn did not fail closed.");
  assert(!taskA.runs.some((run) => run.id === "run-owner-a-running"), "Active owner turn remained usable after runtime loss.");
  await waitFor(() => Boolean(document.querySelector(".thread-content .business-result-table")), "Collection business result did not render.");
  assert(document.body.textContent?.includes("让 AI 自动整理资料的 5 个方法") && document.body.textContent?.includes("一只产品汪"),
    "The task turn did not show actual Xiaohongshu search content.");
  await waitFor(
    () => Boolean(document.querySelector(".thread-content .business-result-message[aria-label='没有匹配数据']")),
    "Core empty_result did not render the business empty state.",
  );
  const firstTimestamp = document.querySelector<HTMLElement>(".task-turn-timestamp");
  assert(firstTimestamp?.textContent?.includes("API"), "Non-App creation channel is not visible beside the timestamp.");
  assert(!document.querySelector(".task-turn-timestamp")?.textContent?.includes("APP"), "App creation channel should stay implicit.");
  assert(!document.body.textContent?.includes("执行过程") && !document.body.textContent?.includes("Capability attribution"),
    "Technical run details still dominate the business timeline.");
  assertThreadContentGeometry(false);
  const selectionCell = document.querySelector<HTMLElement>(".thread-content .business-result-table .selection-cell");
  assert(selectionCell && selectionCell.getBoundingClientRect().width <= 40, "Collection selection column is wider than the compact contract.");
  assert(document.querySelectorAll(".thread-content .business-result-table tbody tr").length === 5 && document.body.textContent?.includes("共 15 条，点击查看更多"),
    "Collection pagination summary does not match the approved result pattern.");
  assert(appShell.dataset.rightPanelOpen === "false", "Right panel should be closed initially.");
  assert(appShell.dataset.leftPanelWidth === "300", "Corrupt left-panel width did not use the default.");
  assert(matchMedia("(prefers-reduced-motion: reduce)").matches, "Reduced motion was not emulated.");
  const menuActions = document.querySelector<HTMLElement>(".task-list-heading-actions");
  assert(menuActions && getComputedStyle(menuActions).transitionDuration === "0s", "Reduced-motion CSS did not disable transitions.");
  document.querySelector<HTMLButtonElement>("[aria-label='新建任务']")?.click();
  assert(createTaskSelection === undefined, "Global create-task entry leaked its click event into the task selection contract.");
  document.querySelector<HTMLButtonElement>(".task-group-add")?.click();
  assert(createTaskSelection?.id === taskAId, "Skill-group create-task entry did not preserve its task selection.");
  await waitFor(() => document.body.textContent?.includes("允许这一次") === true && document.body.textContent?.includes("拒绝这一次") === true,
    "Active Core confirmation did not render both single-action choices.");
  const denyOnce = Array.from(document.querySelectorAll<HTMLButtonElement>(".single-action-actions button"))
    .find((button) => button.textContent?.includes("拒绝这一次"));
  assert(denyOnce, "Single-action deny button is missing.");
  denyOnce.click();
  await waitFor(() => document.body.textContent?.includes("重试这次决定") === true, "Single-action failure did not expose retry.");
  document.querySelector<HTMLButtonElement>(".single-action-confirmation.failed button")?.click();
  await waitFor(() => document.body.textContent?.includes("已拒绝这一次。") === true, "Single-action deny did not settle in the UI.");
  const decisionRequests = authorizationRequests.filter((request) => request.path.endsWith("/single-action"));
  const decisionRequest = decisionRequests[0];
  assert(decisionRequests.length === 2 && decisionRequest?.method === "POST" && (decisionRequest.body as { choice?: string })?.choice === "deny_once" &&
    (decisionRequests[0]?.body as { idempotency_key?: string })?.idempotency_key ===
      (decisionRequests[1]?.body as { idempotency_key?: string })?.idempotency_key,
    "Single-action choice was not sent to the Core owner endpoint.");
  assert(!authorizationRequests.some((request) => request.method === "PUT"), "Single-action confirmation mutated a persistent execution policy.");

  const opener = previewButton();
  assert(opener, "Preview opener is missing.");
  opener.focus();
  opener.click();
  await waitFor(
    () => appShell.dataset.rightPanelOpen === "true" && document.activeElement === rightPanel(),
    "Opening the right panel did not move focus into it.",
  );
  assert(document.querySelector('[role="tab"][data-state="active"]')?.textContent?.includes("结果"),
    "A result preview did not activate the result tab.");
  await waitFor(() => document.querySelectorAll(".right-panel .business-result-table tbody tr").length === 1,
    "A row preview did not preserve the selected item in the right panel.");
  const readDetail = document.querySelector<HTMLButtonElement>(".right-panel [data-read-result-detail]");
  assert(readDetail, "A selected owner detail ref did not expose the business detail handoff.");
  assert(!document.body.textContent?.includes(nestedDetailRefs[0]!), "An opaque detail ref leaked into visible UI text.");
  readDetail.click();
  assert(selectedResultDetailRef === nestedDetailRefs[0], "The business detail handoff did not preserve the selected owner ref.");
  assert(Number(appShell.dataset.rightPanelWidth) > 320, "Corrupt right-panel preferences did not use the default width.");

  const closeButton = document.querySelector<HTMLButtonElement>('[data-shell-panel-toggle="right"]');
  assert(closeButton, "Right-panel close button is missing.");
  closeButton.focus();
  closeButton.click();
  await waitFor(
    () => appShell.dataset.rightPanelOpen === "false" && document.activeElement === opener,
    "Closing the right panel did not return focus to its opener.",
  );

  opener.click();
  await waitFor(() => appShell.dataset.rightPanelOpen === "true", "Task A right panel did not reopen.");
  taskButton(taskBId)?.click();
  await waitFor(
    () => taskButton(taskBId)?.getAttribute("aria-current") === "page"
      && appShell.dataset.rightPanelOpen === "false",
    "Task B did not restore its closed right-panel state.",
  );
  assertThreadContentGeometry(true);
  taskButton(taskAId)?.click();
  await waitFor(
    () => taskButton(taskAId)?.getAttribute("aria-current") === "page"
      && appShell.dataset.rightPanelOpen === "true",
    "Task A did not restore its open right-panel state.",
  );
  taskButton(emptyTaskId)?.click();
  await waitFor(
    () => document.body.textContent?.includes("暂无任务回合") === true &&
      document.body.textContent?.includes("该线程已创建，尚未提交业务输入。") === true,
    "Opening the empty owner thread did not render its business empty state.",
  );
  taskButton(taskAId)?.click();
  await waitFor(() => Boolean(previewButton()), "Task A did not restore after the empty thread check.");

  return {
    emptyThreadOpenState: true,
    ownerProjection: true,
    nonAppCreationChannel: true,
    runtimeFailClosed: true,
    rightPanelFocusAndRestore: true,
    corruptPreferenceFallback: true,
    reducedMotion: true,
    singleActionDecision: true,
  };
}

function resultModel(run: (typeof tasks)[number]["runs"][number], expected: string, data: Record<string, unknown>, resultKind: string) {
  const model = projectStandardBusinessResult(run, readyResult(data, resultKind), [{
    outputKind: resultKind,
    outputSchemaId: "schema:result/v1",
    packageRef: "package:result@1.0.0",
    version: "1.0.0",
    lockRef: "lock:result@1.0.0",
  }]);
  assert(model.kind === expected, `${expected} result did not use the standard renderer.`);
  return model;
}

function readyResult(data: Record<string, unknown> | undefined, resultKind: string) {
  return {
    status: "ready" as const,
    result: {
      outcome: "success",
      resultKind,
      outputSchemaId: "schema:result/v1",
      packageRef: "package:result@1.0.0",
      capabilityVersion: "1.0.0",
      capabilityLockRef: "lock:result@1.0.0",
      ...(data == null ? {} : { data }),
      payloadState: "available",
      envelopeState: "available",
    },
  };
}

function readyXhsSearchResult(publicSummary: Record<string, unknown>) {
  return {
    status: "ready" as const,
    result: {
      outcome: "success",
      resultKind: "xhs_note_search",
      outputSchemaId: "lode://schema/site-capability/xiaohongshu/search-notes/output@0.1.0",
      packageRef: "lode://site-capability/xiaohongshu/search-notes@0.1.0",
      capabilityVersion: "0.1.0",
      capabilityLockRef: "lode://lock/site-capability/xiaohongshu/search-notes@0.1.0",
      data: { projection: { normalized: { public_summary: publicSummary } } },
      payloadState: "available",
      envelopeState: "available",
    },
  };
}

function readyFailure(code: string) {
  return {
    status: "ready" as const,
    result: {
      outcome: "failed",
      payloadState: "unavailable",
      envelopeState: "available",
      failure: { code, recoveryHint: "retry" },
    },
  };
}

function readyUnavailableResult(unavailableReason: string) {
  return {
    status: "ready" as const,
    result: {
      outcome: "success",
      payloadState: "unavailable",
      envelopeState: "unavailable",
      unavailableReason,
    },
  };
}

function readyPayloadState(payloadState: string) {
  return {
    status: "ready" as const,
    result: { outcome: "success", payloadState, envelopeState: "available" },
  };
}

function assertThreadContentGeometry(expectRail: boolean) {
  const threadBody = document.querySelector<HTMLElement>(".thread-body");
  const threadContent = document.querySelector<HTMLElement>(".thread-content");
  const gridColumns = threadBody == null ? [] : getComputedStyle(threadBody).gridTemplateColumns.split(" ");
  const contentTrack = Number.parseFloat(gridColumns.at(-1) ?? "");
  const contentWidth = threadContent?.getBoundingClientRect().width ?? Number.NaN;
  const railVisible = document.querySelector(".thread-navigation-rail") != null;
  assert(threadBody && threadContent && getComputedStyle(threadContent).gridColumnStart === "2" &&
    Math.abs(contentWidth - contentTrack) <= 1 && railVisible === expectRail,
    `Task thread geometry did not preserve the business-content column with rail ${expectRail ? "visible" : "hidden"}.`);
}

async function runNarrowChecks() {
  const appShell = shell();
  assert(appShell, "AppShell is missing at narrow width.");
  await waitFor(
    () => innerWidth === 720 && appShell.dataset.rightPanelOpen === "false",
    "Narrow layout did not collapse the right panel.",
  );
  assertThreadContentGeometry(false);
  const opener = previewButton();
  assert(opener, "Narrow preview opener is missing.");
  opener.focus();
  opener.click();
  await nextFrame();
  await nextFrame();
  await waitFor(() => appShell.dataset.rightPanelOpen === "true", "Narrow right panel did not open.");
  await waitFor(() => {
    const panelRect = document.querySelector<HTMLElement>(".right-panel-resizer")?.getBoundingClientRect();
    const contentRect = document.querySelector<HTMLElement>(".content-region-body")?.getBoundingClientRect();
    return appShell.dataset.rightPanelFullscreen === "true"
      && panelRect != null
      && contentRect != null
      && Math.abs(panelRect.width - contentRect.width) <= 1;
  }, "720px right panel did not settle to the content-region width.");
  const panelRect = document.querySelector<HTMLElement>(".right-panel-resizer")?.getBoundingClientRect();
  const contentRect = document.querySelector<HTMLElement>(".content-region-body")?.getBoundingClientRect();
  assert(panelRect && contentRect, "Narrow panel geometry is unavailable.");
  assert(appShell.dataset.rightPanelFullscreen === "true", "720px right panel is not full width.");
  assert(Math.abs(panelRect.width - contentRect.width) <= 1, "720px right panel does not fill the content region.");
  assert(document.documentElement.scrollWidth <= innerWidth, "720px layout has horizontal overflow.");
  return { fullWidthRightPanel: true, horizontalOverflow: false, viewport: `${innerWidth}x${innerHeight}` };
}

window.__runWorkbenchDomSmoke = async (phase: "desktop" | "narrow") =>
  phase === "desktop" ? runDesktopChecks() : runNarrowChecks();

declare global {
  interface Window {
    __runWorkbenchDomSmoke: (phase: "desktop" | "narrow") => Promise<Record<string, unknown>>;
  }
}
