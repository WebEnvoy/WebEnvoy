import { CheckCircle2, Circle, PauseCircle, XCircle } from "lucide-react";
import type { ReactNode } from "react";

import type { RunProjection } from "./taskThreadFixtures";

function runStatusLabel(run: RunProjection) {
  if (run.lifecycle === "running") {
    return `${run.label} 正在执行`;
  }

  if (run.lifecycle === "queued") {
    return `${run.label} 等待执行`;
  }

  if (run.lifecycle === "needs-action") {
    return `${run.label} 需要处理`;
  }

  if (run.lifecycle === "blocked") {
    return `${run.label} 已受阻`;
  }

  return `${run.label} 已完成`;
}

export function runReportTitle(run: RunProjection) {
  if (run.lifecycle === "running") {
    return "任务运行中";
  }

  if (run.lifecycle === "queued") {
    return "等待执行";
  }

  if (run.lifecycle === "needs-action") {
    return "需要处理";
  }

  if (run.lifecycle === "blocked") {
    return "任务受阻";
  }

  return "任务结束报告";
}

function CodexLikeSpinnerIcon() {
  return (
    <svg className="status-spinner-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        opacity="0.3"
        d="M18 12C18 8.68629 15.3137 6 12 6C8.68629 6 6 8.68629 6 12C6 15.3137 8.68629 18 12 18C15.3137 18 18 15.3137 18 12ZM20 12C20 16.4183 16.4183 20 12 20C7.58172 20 4 16.4183 4 12C4 7.58172 7.58172 4 12 4C16.4183 4 20 7.58172 20 12Z"
        fill="currentColor"
      />
      <path
        d="M12 4C16.4183 4 20 7.58172 20 12C20 16.4183 16.4183 20 12 20C7.58172 20 4 16.4183 4 12H6C6 15.3137 8.68629 18 12 18C15.3137 18 18 15.3137 18 12C18 8.68629 15.3137 6 12 6V4Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function RunStatusGlyph({ compact = false, run }: { compact?: boolean; run: RunProjection }) {
  const iconSize = compact ? 13 : 16;
  const label = runStatusLabel(run);
  const className = `run-status-glyph run-status-${run.lifecycle}${compact ? " compact" : ""}`;
  let icon: ReactNode = <CheckCircle2 size={iconSize} strokeWidth={2.15} />;

  if (run.lifecycle === "running") {
    icon = <CodexLikeSpinnerIcon />;
  } else if (run.lifecycle === "queued") {
    icon = <Circle size={iconSize} strokeWidth={2.1} />;
  } else if (run.lifecycle === "needs-action") {
    icon = <PauseCircle size={iconSize} strokeWidth={2.1} />;
  } else if (run.lifecycle === "blocked") {
    icon = <XCircle size={iconSize} strokeWidth={2.1} />;
  }

  return (
    <span className={className} title={label} aria-label={label} role="img">
      {icon}
    </span>
  );
}
