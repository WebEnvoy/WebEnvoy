import type { RunProjection, TaskProjection } from "./taskThreadFixtures";
import {
  bossProductionDeferredReason,
  isBossProductionSkill,
  isBossProductionTask,
} from "../electron/productionTaskPolicy";

export { bossProductionDeferredReason, isBossProductionSkill, isBossProductionTask } from "../electron/productionTaskPolicy";

/**
 * Project BOSS task history as an explicitly deferred product surface.
 * Only Core-live failures remain actionable as historical diagnostics; no
 * fixture, fallback, success, running, or preview projection is presented as
 * a current production capability.
 */
export function projectDeferredBossTask(task: TaskProjection): TaskProjection {
  if (!isBossProductionTask(task)) return task;

  const historicalFailures = task.runs
    .filter(isBossHistoricalFailure)
    .map(projectHistoricalFailure);
  const deferredRun: RunProjection = {
    id: `boss-deferred-${task.id}`,
    label: "访问受限",
    lifecycle: "blocked",
    outcome: "unavailable",
    summary: bossProductionDeferredReason,
    actionIntent: "可继续查看身份摘要、手动浏览器现场和历史失败诊断；自动任务命令不可执行。",
    owner: "Core",
    source: "App local-only",
    resultRows: [
      { label: "当前访问", value: "受限", source: "App local-only" },
      { label: "自动任务", value: "延期且不可执行", source: "App local-only" },
    ],
    evidenceCards: [],
    capabilityAttribution: {
      capabilityRef: task.packageSource.capabilityRef,
      version: task.packageSource.version,
      sourceRef: task.packageSource.sourceRef,
      failureClass: "runtime_admission_disabled",
      summary: "保留 capability metadata 仅供历史诊断；不代表当前可运行。",
    },
    failureRecovery: {
      state: "访问受限",
      reason: bossProductionDeferredReason,
      nextActions: ["保留历史诊断", "等待目标站点恢复评估"],
      source: "App local-only",
    },
    process: ["BOSS production task commands are disabled before Core submission."],
  };

  return {
    ...task,
    blocker: bossProductionDeferredReason,
    packageSource: {
      ...task.packageSource,
      boundary: `${bossProductionDeferredReason}；metadata 和历史失败仅供诊断，不构成当前 capability 可用证明。`,
    },
    runs: [deferredRun, ...historicalFailures],
  };
}

function isBossHistoricalFailure(run: RunProjection) {
  return run.source === "Core live" && run.lifecycle !== "running" && run.outcome !== "success" && run.writePrecheck?.state !== "available" && (
    run.failureRecovery != null ||
    run.outcome === "failure" ||
    run.outcome === "failure-safe" ||
    run.outcome === "unavailable" ||
    run.lifecycle === "blocked"
  );
}

function projectHistoricalFailure(run: RunProjection): RunProjection {
  const ownerUpdatedAt = (run as RunProjection & { ownerUpdatedAt?: string }).ownerUpdatedAt;
  const timestamp = run.terminalAt ?? run.updatedAt;
  const category = run.capabilityAttribution?.failureClass && run.capabilityAttribution.failureClass !== "none"
    ? run.capabilityAttribution.failureClass
    : run.resultRows.find((row) => row.label === "失败代码")?.value ?? "unknown";
  const resultRows = [...run.resultRows];
  const addMetadata = (label: string, value: string | undefined) => {
    if (value != null && !resultRows.some((row) => row.label === label)) {
      resultRows.unshift({ label, value, source: "Core live" });
    }
  };
  addMetadata("失败类别", category);
  addMetadata("时间", timestamp);
  addMetadata("来源", "Core live");
  addMetadata("Owner updated at", ownerUpdatedAt);
  return {
    ...run,
    label: `历史失败 · ${run.label}`,
    lifecycle: "blocked",
    resultRows,
  };
}
