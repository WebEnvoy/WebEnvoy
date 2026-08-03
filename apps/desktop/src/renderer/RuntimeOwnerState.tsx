import { OwnerState } from "./OwnerState";
import {
  runtimeService,
  type RuntimeSupervisorState,
} from "./runtimeSupervisorState";

export function RuntimeCheckingOwnerState() {
  return <OwnerState title="正在检查运行环境" summary="确认本机服务可用后即可继续。" />;
}

export function RuntimeBlockedOwnerState({
  runtime,
  onOpenBrowser,
  onOpenSettings,
}: {
  runtime: RuntimeSupervisorState;
  onOpenBrowser: () => void;
  onOpenSettings: () => void;
}) {
  const core = runtimeService(runtime, "core");
  const harbor = runtimeService(runtime, "harbor");
  const coreHealth = core?.health.state ?? "unknown";
  const coreAdmission = core?.admission?.state ?? "unknown";
  const harborHealth = harbor?.health.state ?? "unknown";
  const harborOnlyBlocked =
    coreHealth === "ready" &&
    coreAdmission === "ready" &&
    runtime.lodeAssets.state === "ready" &&
    harborHealth !== "ready";

  return (
    <OwnerState
      aria-label="运行环境状态"
      data-testid="runtime-supervisor-status"
      data-runtime-state="unavailable"
      data-runtime-core-health={coreHealth}
      data-runtime-core-admission={coreAdmission}
      data-runtime-harbor-health={harborHealth}
      title="运行环境暂不可用"
      summary={harborOnlyBlocked
        ? "账号身份运行环境尚未就绪，暂时无法创建或继续任务。"
        : "本机运行环境尚未就绪，暂时无法创建或继续任务。"}
      actionLabel={harborOnlyBlocked ? "检查账号身份" : "检查运行环境"}
      recoverButtonFocusKey="runtime-owner-state"
      onRecover={harborOnlyBlocked ? onOpenBrowser : onOpenSettings}
    />
  );
}
