import {
  Activity,
  Box,
  Braces,
  ExternalLink,
  Globe2,
  ShieldCheck,
  ArrowRight,
} from "lucide-react";
import { useEffect, useState } from "react";

import { fetchCoreRunResult, type CoreRunResultState } from "./coreRunResultClient";
import type { LodeCatalogSkill } from "./lodeCatalogClient";
import { TaskBusinessResult } from "./TaskBusinessResult";
import { ContextPanel, SourceField } from "./TaskThreadFields";
import { PanelTabs } from "./shellPrimitives";
import type { CoreReadTaskLoadState } from "./coreReadTaskClient";
import type { CoreTaskSubmitState } from "./coreTaskSubmitClient";
import { type RuntimeSupervisorState } from "./runtimeSupervisorState";
import type { RunProjection, TaskProjection } from "./taskThreadFixtures";
import type { TaskPreviewSelection } from "./useAppTasks";
import { isOpaqueDetailRef } from "./resultDetailHandoff";

type SourceHealth = {
  id: "core" | "harbor" | "lode";
  name: string;
  ownerTruth: string;
  status: "ready" | "unavailable";
  summary: string;
};

type ShellDiagnostics = {
  colorScheme?: string;
  configScope?: string;
  platform?: string;
};

const contextTabs = [
  { id: "result", label: "结果" },
  { id: "evidence", label: "结果依据" },
  { id: "session", label: "执行现场" },
  { id: "identity", label: "账号身份" },
  { id: "skill", label: "站点技能" },
  { id: "diagnostics", label: "诊断" },
];

function statusLabel(status: SourceHealth["status"]) {
  return status === "ready" ? "ready" : "unavailable";
}

export function TaskThreadRightPanel({
  coreEndpoint,
  coreReadState,
  coreSubmitState,
  runtimeSupervisorState,
  selectedRun,
  selectedTask,
  previewSelection,
  onReadDetail,
  skills,
  shellDiagnostics,
}: {
  coreEndpoint: string;
  coreReadState: CoreReadTaskLoadState;
  coreSubmitState: CoreTaskSubmitState;
  runtimeSupervisorState: RuntimeSupervisorState;
  selectedRun: RunProjection;
  selectedTask: TaskProjection;
  previewSelection: TaskPreviewSelection;
  onReadDetail?: (detailRef: string) => Promise<boolean> | boolean;
  skills?: LodeCatalogSkill[];
  shellDiagnostics: ShellDiagnostics;
}) {
  const [activeTab, setActiveTab] = useState<string>(previewSelection.tab);
  useEffect(() => setActiveTab(previewSelection.tab), [previewSelection.runId, previewSelection.tab]);
  return (
    <aside className="context-panel codex-scrollbar" aria-label="Task context">
      <PanelTabs
        ariaLabel="Task context tabs"
        defaultValue="result"
        value={activeTab}
        onValueChange={setActiveTab}
        tabs={contextTabs.map((tab) => ({
          ...tab,
          content:
            tab.id === "result" ? (
              <ResultTab coreEndpoint={coreEndpoint} selectedItemIds={previewSelection.itemIds} selectedRun={selectedRun} skills={skills} onReadDetail={onReadDetail} />
            ) : tab.id === "evidence" ? (
              <EvidenceTab selectedRun={selectedRun} />
            ) : tab.id === "session" ? (
              <SessionTab selectedRun={selectedRun} selectedTask={selectedTask} />
            ) : tab.id === "identity" ? (
              <ContextPanel
                icon={<ShieldCheck size={18} />}
                title="账号身份"
                body={`当前线程的身份绑定来自 ${selectedTask.identitySource ?? selectedTask.source}；身份可用性仍以 Harbor 为准。App 不保存 credential、cookie、token 或 profile storage。`}
              />
            ) : tab.id === "skill" ? (
              <SiteSkillTab selectedTask={selectedTask} />
            ) : (
              <DiagnosticsTab coreSubmitState={coreSubmitState} shellDiagnostics={shellDiagnostics} />
            ),
        }))}
      />

      <SourceHealthSection
        coreReadState={coreReadState}
        runtimeSupervisorState={runtimeSupervisorState}
        selectedTask={selectedTask}
      />
    </aside>
  );
}

function ResultTab({ coreEndpoint, selectedItemIds, selectedRun, skills, onReadDetail }: {
  coreEndpoint: string;
  selectedItemIds?: string[];
  selectedRun: RunProjection;
  skills?: LodeCatalogSkill[];
  onReadDetail?: (detailRef: string) => Promise<boolean> | boolean;
}) {
  const [state, setState] = useState<CoreRunResultState | { status: "fixture" }>(() => selectedRun.source === "Core live" ? { status: "loading" } : { status: "fixture" });
  const [handoffState, setHandoffState] = useState<"idle" | "loading" | "failed">("idle");
  const detailRef = selectedItemIds?.length === 1 && isOpaqueDetailRef(selectedItemIds[0]) ? selectedItemIds[0] : undefined;
  useEffect(() => {
    if (selectedRun.source !== "Core live") {
      setState({ status: "fixture" });
      return;
    }
    const controller = new AbortController();
    setState({ status: "loading" });
    void fetchCoreRunResult(coreEndpoint, selectedRun.id, controller.signal).then((next) => {
      if (!controller.signal.aborted) setState(next);
    });
    return () => controller.abort();
  }, [coreEndpoint, selectedRun.id, selectedRun.source, selectedRun.updatedAt]);
  useEffect(() => setHandoffState("idle"), [detailRef]);
  return (
    <div className="context-copy task-result-preview">
      <div className="card-title"><Box size={18} /><h3>{selectedRun.label}</h3></div>
      <TaskBusinessResult resultState={state} run={selectedRun} selectedItemIds={selectedItemIds} skills={skills} />
      {detailRef != null && onReadDetail != null ? (
        <div className="task-result-detail-action">
          <button
            type="button"
            className="production-primary-button"
            data-read-result-detail
            disabled={handoffState === "loading"}
            onClick={async () => {
              setHandoffState("loading");
              try {
                setHandoffState(await onReadDetail(detailRef) ? "idle" : "failed");
              } catch {
                setHandoffState("failed");
              }
            }}
          >
            读取详情<ArrowRight size={14} />
          </button>
          {handoffState === "failed" ? <span role="status">当前无法创建详情任务。</span> : null}
        </div>
      ) : null}
    </div>
  );
}

function DiagnosticsTab({
  coreSubmitState,
  shellDiagnostics,
}: {
  coreSubmitState: CoreTaskSubmitState;
  shellDiagnostics: ShellDiagnostics;
}) {
  return (
    <div className="context-copy">
      <div className="card-title">
        <Activity size={18} />
        <h3>诊断</h3>
      </div>
      <p>
        Shell context: {shellDiagnostics.platform ?? "loading"} / {shellDiagnostics.colorScheme ?? "loading"} / {shellDiagnostics.configScope ?? "loading"}.
        UI selection state is App local-only.
      </p>
      <dl className="context-facts compact">
        <SourceField label="Core submit" value={coreSubmitState.status} source="App local-only" />
        <SourceField label="Run id" value={"runId" in coreSubmitState ? coreSubmitState.runId ?? "not submitted" : "not submitted"} source="Core live" />
        <SourceField label="Submit summary" value={coreSubmitState.summary} source="App local-only" />
      </dl>
    </div>
  );
}

function EvidenceTab({ selectedRun }: { selectedRun: RunProjection }) {
  return (
    <div className="context-copy">
      <div className="card-title">
        <Braces size={18} />
        <h3>结果依据</h3>
      </div>
      <p>Evidence card only links owner viewer refs; App does not read raw evidence body.</p>
      {selectedRun.writePrecheck ? (
        <dl className="context-facts compact">
          <SourceField label="Preview state" value={selectedRun.writePrecheck.state} source={selectedRun.source} />
          <SourceField label="Submitted" value={selectedRun.writePrecheck.submittedLabel ?? "false / 未提交"} source={selectedRun.source} />
          <SourceField label="No-submit guard" value={selectedRun.writePrecheck.noSubmitGuard} source={selectedRun.source} />
          <SourceField label="State note" value={selectedRun.writePrecheck.stateNote} source={selectedRun.source} />
        </dl>
      ) : null}
      {selectedRun.fieldSources ? (
        <>
          <h3 className="subsection-title">字段来源</h3>
          <dl className="context-facts compact">
            {selectedRun.fieldSources.map((field) => (
              <SourceField
                label={field.field}
                value={`${field.locator} · ${field.evidenceRef}`}
                source={field.source}
                key={`${selectedRun.id}-${field.field}`}
              />
            ))}
          </dl>
        </>
      ) : null}
      <div className="context-card-list">
        {selectedRun.evidenceCards.map((evidence) => (
          <article className="context-card" key={evidence.id}>
            <strong>{evidence.title}</strong>
            <p>{evidence.summary}</p>
            <dl className="context-facts compact">
              <SourceField label="Status" value={evidence.status ?? "available"} source={evidence.source} />
              <SourceField label="Freshness" value={evidence.freshness ?? "fresh"} source={evidence.source} />
              <SourceField
                label="Provenance"
                value={evidence.provenance ?? "owner viewer ref"}
                source={evidence.source}
              />
            </dl>
            <a href={evidence.viewerHref}>
              <ExternalLink size={14} />
              {evidence.viewerLabel}
            </a>
            <span className="source-chip">{evidence.source}</span>
          </article>
        ))}
      </div>
    </div>
  );
}

function SessionTab({
  selectedRun,
  selectedTask,
}: {
  selectedRun: RunProjection;
  selectedTask: TaskProjection;
}) {
  const { runtimeSessionRef, viewerRef } = sessionRefsForRun(selectedRun);
  const status = runtimeSessionRef == null ? "unavailable" : "ready";

  return (
    <div className="context-copy">
      <div className="card-title">
        <Globe2 size={18} />
        <h3>执行现场</h3>
        <span className={`status-pill status-${status}`}>{status}</span>
      </div>
      <p>
        {runtimeSessionRef == null
          ? "当前 Run 没有暴露可打开的 Harbor runtime session ref；App 不使用无关本机浏览器现场代替任务现场。"
          : "执行现场来自当前 Run 的 Core/Harbor owner refs；App 只展示引用，不读取 profile、Cookie、token、CDP 或 raw evidence。"}
      </p>
      <dl className="context-facts">
        <SourceField label="Task" value={selectedTask.title} source={selectedTask.source} />
        <SourceField label="Run" value={selectedRun.label} source={selectedRun.source} />
        <SourceField
          label="Runtime session"
          value={runtimeSessionRef ?? "not exposed for this run"}
          source={selectedRun.source}
        />
        <SourceField
          label="Viewer ref"
          value={viewerRef ?? "not exposed for this run"}
          source={selectedRun.source}
        />
      </dl>
      <p className="boundary-copy">
        Execution-site facts must be selected-run owner refs; App does not store browser profile
        storage or raw runtime material.
      </p>
    </div>
  );
}

function sessionRefsForRun(run: RunProjection) {
  const rowRefs = run.resultRows
    .filter((row) => row.label === "执行现场" || row.label === "Runtime session" || row.label === "Viewer ref")
    .map((row) => row.value);
  const fieldRef = run.fieldSources?.find((field) => field.locator.startsWith("harbor:runtime-session/"))?.locator;
  const evidenceRuntimeRef = run.evidenceCards
    .map((card) => /harbor:runtime-session\/[^;.)\s]+/.exec(card.summary)?.[0])
    .find((ref): ref is string => Boolean(ref));
  const runtimeSessionRef =
    rowRefs.find((ref) => ref.startsWith("harbor:runtime-session/")) ?? fieldRef ?? evidenceRuntimeRef;
  const viewerRef = rowRefs.find((ref) => ref.startsWith("viewer://"));
  return { runtimeSessionRef, viewerRef };
}

function SiteSkillTab({ selectedTask }: { selectedTask: TaskProjection }) {
  return (
    <div className="context-copy">
      <div className="card-title">
        <Box size={18} />
        <h3>站点技能</h3>
      </div>
      <p>当前仅展示 Core 线程绑定的 capability ref；技能名称、版本和安装状态仍以 Lode owner 数据为准。</p>
      <dl className="context-facts">
        {[
          ["Package", selectedTask.packageSource.name],
          ["Version", selectedTask.packageSource.version],
          ["Capability ref", selectedTask.packageSource.capabilityRef],
          ["Source ref", selectedTask.packageSource.sourceRef],
          ["Lock ref", selectedTask.packageSource.lockRef ?? "unlocked"],
          ["Fetched at", selectedTask.packageSource.fetchedAt],
        ].map(([label, value]) => (
          <SourceField
            label={label}
            value={value}
            source={selectedTask.packageSource.source}
            key={label}
          />
        ))}
      </dl>
      <p className="boundary-copy">
        Work failure links back to capability health through Core run attribution; App keeps only the selected ref
        and local navigation state.
      </p>
      <p className="boundary-copy">{selectedTask.packageSource.boundary}</p>
    </div>
  );
}

function SourceHealthSection({
  coreReadState,
  runtimeSupervisorState,
  selectedTask,
}: {
  coreReadState: CoreReadTaskLoadState;
  runtimeSupervisorState: RuntimeSupervisorState;
  selectedTask: TaskProjection;
}) {
  const coreStatus: SourceHealth["status"] =
    coreReadState.status === "ready" ? "ready" : "unavailable";
  const harborStatus: SourceHealth["status"] =
    runtimeSupervisorState.services.find((service) => service.id === "harbor")?.health.state === "ready"
      ? "ready"
      : "unavailable";
  const lodeStatus: SourceHealth["status"] =
    runtimeSupervisorState.lodeAssets.state === "ready" ? "ready" : "unavailable";
  const sources: SourceHealth[] = [
    {
      id: "core",
      name: "Core",
      ownerTruth: "任务线程与回合",
      status: coreStatus,
      summary: coreStatus === "ready" ? coreReadState.summary : "Core 线程读取不可用；保留终态时仍阻断活动回合。",
    },
    {
      id: "harbor",
      name: "Harbor",
      ownerTruth: "账号身份与执行现场",
      status: harborStatus,
      summary: harborStatus === "ready" ? "Harbor runtime 可用。" : "Harbor runtime 不可用；不会使用 fixture/demo 代替。",
    },
    {
      id: "lode",
      name: "Lode",
      ownerTruth: "站点技能与能力版本",
      status: lodeStatus,
      summary: lodeStatus === "ready"
        ? `${runtimeSupervisorState.lodeAssets.summary} 当前线程绑定 ${selectedTask.packageSource.capabilityRef}。`
        : `Lode capability assets 不可用；尚未解析 ${selectedTask.packageSource.capabilityRef} 的 owner metadata。`,
    },
  ];

  return (
    <section className="source-health" id="source-health">
      <div className="section-heading">
        <span>来源</span>
        <span className="badge">{runtimeSupervisorState.canUseLiveRuntime ? coreReadState.status : "fail-closed"}</span>
      </div>
      {sources.map((source) => (
        <article className="source-card" key={source.id}>
          <div>
            <strong>{source.name}</strong>
            <span className={`status-pill status-${source.status}`}>{statusLabel(source.status)}</span>
          </div>
          <p>{source.ownerTruth}</p>
          <p>{source.summary}</p>
        </article>
      ))}
    </section>
  );
}
