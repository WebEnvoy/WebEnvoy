import { CircleAlert, RefreshCw, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  appendTaskThreadTurn,
  cancelTaskThreadTurn,
  initialTaskThreadSubmitState,
  reconcileTaskThreadTurn,
  type TaskThreadSubmitState,
} from "./coreTaskThreadSubmitClient";
import type { HarborIdentityLoadState } from "./harborIdentityTypes";
import type { LodeCatalogSkill } from "./lodeCatalogClient";
import type { RuntimeSupervisorState } from "./runtimeSupervisorState";
import { StructuredTaskComposer } from "./StructuredTaskComposer";
import type { TaskProjection } from "./taskThreadFixtures";

export function TaskThreadComposer({
  coreEndpoint,
  harborIdentityState,
  runtimeSupervisorState,
  selectedTask,
  skill,
  onTask,
}: {
  coreEndpoint: string;
  harborIdentityState: HarborIdentityLoadState;
  runtimeSupervisorState: RuntimeSupervisorState;
  selectedTask: TaskProjection;
  skill?: LodeCatalogSkill;
  onTask: (task: TaskProjection) => void;
}) {
  const [recoveryState, setRecoveryState] = useState<TaskThreadSubmitState>(initialTaskThreadSubmitState);
  const recoveryRequest = useRef(0);
  const recoveryStatusRef = useRef<HTMLSpanElement>(null);
  const identity = harborIdentityState.identities.find((item) =>
    item.identityEnvironmentRef === selectedTask.threadContext?.accountIdentityKey,
  );
  const unknownRun = selectedTask.runs.find((run) => run.turnStatus === "status_unknown");
  const unknownAttempt = unknownRun?.idempotencyKey == null
    ? undefined
    : { threadRef: selectedTask.id, idempotencyKey: unknownRun.idempotencyKey };
  const recoverableRun = unknownRun ?? selectedTask.runs.find((run) => run.turnStatus === "waiting_for_user");
  const ownerUnavailable = skill == null || identity == null || selectedTask.threadContext == null;
  useEffect(() => () => {
    recoveryRequest.current += 1;
  }, []);
  useEffect(() => {
    recoveryRequest.current += 1;
    setRecoveryState((current) =>
      current.status === "ready" && unknownAttempt == null && ownerUnavailable ? current : initialTaskThreadSubmitState,
    );
  }, [selectedTask.id, unknownAttempt?.idempotencyKey, ownerUnavailable]);
  if (ownerUnavailable) {
    async function recover(action: "reconcile" | "terminate") {
      const request = ++recoveryRequest.current;
      setRecoveryState({ status: "submitting", summary: action === "reconcile" ? "正在重新检查当前回合。" : "正在停止当前回合。" });
      const result = action === "reconcile"
        ? unknownAttempt == null ? undefined : await reconcileTaskThreadTurn(coreEndpoint, unknownAttempt)
        : recoverableRun?.turnId == null ? undefined : await cancelTaskThreadTurn(coreEndpoint, selectedTask.id, recoverableRun.turnId);
      if (request !== recoveryRequest.current) return;
      if (result == null) {
        setRecoveryState(initialTaskThreadSubmitState);
        return;
      }
      setRecoveryState(result);
      if ("task" in result && result.task != null) onTask(result.task);
      window.requestAnimationFrame(() => recoveryStatusRef.current?.focus());
    }
    return (
      <div className="thread-composer composer-owner-state">
        <CircleAlert size={15} />
        <span ref={recoveryStatusRef} role="status" tabIndex={-1}>{recoveryState.status === "idle"
          ? skill == null ? "当前线程的站点技能合同不可用。" : "当前线程绑定的账号身份不可用。"
          : recoveryState.summary}</span>
        {unknownAttempt == null ? null : (
          <button className="composer-icon-button" type="button" disabled={recoveryState.status === "submitting"} aria-label="重新检查当前回合" title="重新检查当前回合" onClick={() => void recover("reconcile")}><RefreshCw size={14} /></button>
        )}
        {recoverableRun?.turnId == null ? null : (
          <button className="composer-icon-button" type="button" disabled={recoveryState.status === "submitting"} aria-label="停止当前回合" title="停止当前回合" onClick={() => void recover("terminate")}><Square size={13} /></button>
        )}
      </div>
    );
  }
  const activeRun = selectedTask.runs.find((run) =>
    run.turnStatus === "submitting" || run.turnStatus === "accepted" || run.turnStatus === "running" ||
    run.turnStatus === "waiting_for_user" || run.turnStatus === "status_unknown",
  );
  const submitBlockedReason = activeRun == null
    ? undefined
    : `${activeRun.label}尚未结束；可以继续编辑下一次业务输入，结束后再提交。`;
  return (
    <StructuredTaskComposer
      endpoint={coreEndpoint}
      identity={identity}
      runtime={runtimeSupervisorState}
      skill={skill}
      threadRef={selectedTask.id}
      submitBlockedReason={submitBlockedReason}
      activeTurnLabel={activeRun?.label}
      initialUnknownAttempt={unknownAttempt}
      submitLabel="提交回合"
      onCancelActiveTurn={activeRun?.turnId == null ? undefined : () => cancelTaskThreadTurn(coreEndpoint, selectedTask.id, activeRun.turnId!)}
      onSubmit={(draft, ownerRefs, executionPolicy) => appendTaskThreadTurn({
        endpoint: coreEndpoint,
        threadRef: selectedTask.id,
        skill,
        identity,
        draft,
        ownerRefs,
        executionPolicy,
        runtime: runtimeSupervisorState,
      })}
      onTask={onTask}
    />
  );
}
