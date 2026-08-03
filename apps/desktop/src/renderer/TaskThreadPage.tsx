import { AlertTriangle, Check, PanelRightOpen, ShieldAlert, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { decideSingleAction, fetchPendingAuthorizationDecision, type PendingAuthorizationDecision } from "./authorizationDecisionClient";
import { fetchCoreRunResult, type CoreRunResultState } from "./coreRunResultClient";
import { policySourceLabel } from "./executionPolicyClient";
import type { LodeCatalogSkill } from "./lodeCatalogClient";
import { TaskBusinessResult } from "./TaskBusinessResult";
import { ThreadNavigationRail, type ThreadNavigationItem } from "./ThreadNavigationRail";
import { RunStatusGlyph } from "./RunStatusGlyph";
import type { RunProjection, TaskProjection } from "./taskThreadFixtures";
import { TaskTurnBusinessInput } from "./TaskTurnBusinessInput";
import type { TaskPreviewSelection } from "./useAppTasks";

export function TaskThreadPage({
  coreEndpoint,
  navigationItems,
  selectedRun,
  selectedTask,
  skill,
  skills,
  onActiveRunChange,
  onOpenPreview,
}: {
  coreEndpoint: string;
  navigationItems: ThreadNavigationItem[];
  selectedRun: RunProjection;
  selectedTask: TaskProjection;
  skill?: LodeCatalogSkill;
  skills?: LodeCatalogSkill[];
  onActiveRunChange: (runId: string) => void;
  onOpenPreview: (selection: TaskPreviewSelection) => void;
}) {
  return (
    <div className="thread-body">
      <ThreadNavigationRail
        activeItemId={selectedRun.id}
        items={navigationItems}
        onActiveItemChange={onActiveRunChange}
      />

      <div className="thread-content">
        <div className="thread-context-strip" aria-label="Task context">
          <span>站点技能 · {selectedTask.siteSkill}</span>
          <span>账号身份 · {selectedTask.accountIdentity}</span>
          <span>业务输入 · {selectedTask.businessInput}</span>
        </div>

        {selectedTask.blocker ? (
          <section className="blocker-card">
            <div className="card-title">
              <AlertTriangle size={18} />
              <h3>当前任务不可继续</h3>
            </div>
            <p>{selectedTask.blocker}</p>
          </section>
        ) : null}

        <div className="run-turn-list" aria-label="Core-owned run timeline">
          {selectedTask.runs.map((run) => (
            <RunTurn
              coreEndpoint={coreEndpoint}
              identityLabel={selectedTask.accountIdentity}
              threadRef={selectedTask.id}
              isSelected={run.id === selectedRun.id}
              key={run.id}
              run={run}
              skill={skill}
              skills={skills}
              onOpenPreview={onOpenPreview}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function RunTurn({
  coreEndpoint,
  identityLabel,
  threadRef,
  run,
  isSelected,
  skill,
  skills,
  onOpenPreview,
}: {
  coreEndpoint: string;
  identityLabel: string;
  threadRef: string;
  run: RunProjection;
  isSelected: boolean;
  skill?: LodeCatalogSkill;
  skills?: LodeCatalogSkill[];
  onOpenPreview: (selection: TaskPreviewSelection) => void;
}) {
  const [resultState, setResultState] = useState<CoreRunResultState | { status: "fixture" }>(() =>
    run.source === "Core live" ? { status: "loading" } : { status: "fixture" },
  );
  useEffect(() => {
    if (run.source !== "Core live") {
      setResultState({ status: "fixture" });
      return;
    }
    const controller = new AbortController();
    setResultState({ status: "loading" });
    void fetchCoreRunResult(coreEndpoint, run.id, controller.signal).then((state) => {
      if (!controller.signal.aborted) setResultState(state);
    });
    return () => controller.abort();
  }, [coreEndpoint, run.id, run.source, run.updatedAt]);

  return (
    <article
      className={isSelected ? "run-turn selected" : "run-turn"}
      data-content-search-unit-key={run.id}
      data-turn-key={run.id}
    >
      {run.businessInput == null ? null : <TaskTurnBusinessInput input={run.businessInput} skill={skill} />}
      <SingleActionConfirmation endpoint={coreEndpoint} identityLabel={identityLabel} run={run} threadRef={threadRef} />
      <TurnExecutionStatus isSelected={isSelected} onOpenPreview={() => onOpenPreview({ runId: run.id, tab: "evidence" })} run={run} />
      <TaskBusinessResult
        onOpenPreview={(request) => onOpenPreview({ runId: run.id, tab: "result", ...request })}
        resultState={resultState}
        run={run}
        skills={skills}
      />
      <TurnFooter run={run} />
    </article>
  );
}

function TurnExecutionStatus({ isSelected, onOpenPreview, run }: { isSelected: boolean; onOpenPreview: () => void; run: RunProjection }) {
  const running = run.lifecycle === "running" || run.lifecycle === "queued";
  const failed = run.outcome === "failure" || run.lifecycle === "blocked";
  const label = running ? "正在执行" : run.turnStatus === "cancelled" ? "已取消" : failed ? "未完成" : run.outcome === "partial" ? "部分完成" : "已处理";
  const duration = running ? "" : formatDuration(run.createdAt, run.terminalAt ?? run.updatedAt);
  return (
    <div className={`turn-execution-status${running ? " running" : ""}${failed ? " failed" : ""}`} aria-current={isSelected ? "step" : undefined}>
      <RunStatusGlyph run={run} />
      <strong>{label}</strong>
      {duration ? <span>{duration}</span> : null}
      {running ? <span className="turn-execution-shimmer" aria-hidden="true" /> : null}
      {run.evidenceCards.length > 0 || run.fieldSources?.length ? <button className="we-toolbar-icon-button cursor-interaction" type="button" aria-label="在右栏打开结果依据" title="在右栏打开结果依据" data-workbench-open-right onClick={onOpenPreview}><PanelRightOpen size={15} /></button> : null}
    </div>
  );
}

function TurnFooter({ run }: { run: RunProjection }) {
  if (run.terminalAt == null) return null;
  return <footer className="task-turn-timestamp"><span>{formatTurnTime(run.terminalAt)}</span>{run.creationChannel && run.creationChannel !== "app" ? <span>{run.creationChannel.toUpperCase()}</span> : null}</footer>;
}

type ConfirmationState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; decision: PendingAuthorizationDecision }
  | { status: "submitting"; decision: PendingAuthorizationDecision }
  | { status: "settled"; summary: string }
  | { status: "failed"; summary: string; retry: "fetch" }
  | {
      status: "failed";
      summary: string;
      retry: "submit";
      decision: PendingAuthorizationDecision;
      choice: "allow_once" | "deny_once";
      idempotencyKey: string;
    };

export function SingleActionConfirmation({ endpoint, identityLabel, run, threadRef }: {
  endpoint: string;
  identityLabel: string;
  run: RunProjection;
  threadRef: string;
}) {
  const [state, setState] = useState<ConfirmationState>({ status: "idle" });
  const [reloadKey, setReloadKey] = useState(0);
  const statusRef = useRef<HTMLElement>(null);
  const refsKey = (run.authorizationDecisionRefs ?? []).join("\u0000");

  useEffect(() => {
    const refs = run.authorizationDecisionRefs ?? [];
    if (run.turnStatus !== "waiting_for_user" || run.turnId == null || refs.length === 0) {
      setState({ status: "idle" });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });
    void fetchPendingAuthorizationDecision(endpoint, {
      decisionRef: refs.at(-1)!,
      runId: run.id,
      threadId: threadRef,
      turnId: run.turnId!,
    }).then((result) => {
      if (cancelled) return;
      setState(result.ok
        ? { status: "ready", decision: result.decision }
        : { status: "failed", summary: result.reason, retry: "fetch" });
    });
    return () => { cancelled = true; };
  }, [endpoint, refsKey, reloadKey, run.id, run.turnId, run.turnStatus, threadRef]);

  async function submitDecision(
    decision: PendingAuthorizationDecision,
    choice: "allow_once" | "deny_once",
    idempotencyKey = `app-single-action-${crypto.randomUUID()}`,
  ) {
    setState({ status: "submitting", decision });
    const result = await decideSingleAction(endpoint, decision.decisionRef, choice, idempotencyKey);
    setState(result.ok
      ? { status: "settled", summary: result.summary }
      : { status: "failed", summary: result.reason, retry: "submit", decision, choice, idempotencyKey });
    window.requestAnimationFrame(() => statusRef.current?.focus());
  }

  function retryFailure() {
    if (state.status !== "failed") return;
    if (state.retry === "fetch") {
      setReloadKey((current) => current + 1);
      return;
    }
    void submitDecision(state.decision, state.choice, state.idempotencyKey);
  }

  if (state.status === "idle" || state.status === "loading") return null;
  if (state.status === "settled") {
    return <section ref={statusRef} className="single-action-confirmation settled" role="status" tabIndex={-1}><span>{state.summary}</span></section>;
  }
  if (state.status === "failed") {
    return (
      <section ref={statusRef} className="single-action-confirmation failed" role="status" tabIndex={-1}>
        <span>{state.summary}</span>
        <button type="button" onClick={retryFailure}>{state.retry === "fetch" ? "重新检查" : "重试这次决定"}</button>
      </section>
    );
  }
  const decision = state.decision;
  const busy = state.status === "submitting";
  return (
    <section className={`single-action-confirmation${decision.destructive ? " destructive" : ""}`} aria-label="当前动作确认">
      <div className="single-action-copy">
        <ShieldAlert size={17} />
        <span>
          <strong>{actionLabel(decision.category)}</strong>
          <small>{identityLabel} · {targetLabel(decision)} · {policySourceLabel(decision.policySource)}</small>
        </span>
      </div>
      {decision.destructive ? <span className="single-action-risk"><AlertTriangle size={13} />危险行为</span> : null}
      <div className="single-action-actions">
        <button type="button" disabled={busy} onClick={() => void submitDecision(decision, "deny_once")}><X size={14} />拒绝这一次</button>
        <button className="primary" type="button" disabled={busy} onClick={() => void submitDecision(decision, "allow_once")}><Check size={14} />{busy ? "处理中" : "允许这一次"}</button>
      </div>
    </section>
  );
}

function actionLabel(category: PendingAuthorizationDecision["category"]) {
  return { read: "读取和下载", prepare: "填写但不提交", commit: "发布或提交", destructive: "危险行为" }[category];
}

function targetLabel(decision: PendingAuthorizationDecision) {
  return [decision.siteSlug, decision.targetType, decision.origin].filter(Boolean).join(" · ") || decision.targetRef;
}

function formatTurnTime(value: string | undefined) {
  if (value == null || !Number.isFinite(Date.parse(value))) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function formatDuration(start: string | undefined, end: string | undefined) {
  if (start == null || end == null) return "";
  const milliseconds = Date.parse(end) - Date.parse(start);
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "";
  const seconds = Math.round(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes} 分 ${seconds % 60} 秒` : `${seconds} 秒`;
}
