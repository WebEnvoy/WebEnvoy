import type { IdentityEnvironmentProjection } from "./identityEnvironmentFixtures";
import type { OwnerSource, RunProjection, TaskProjection } from "./taskThreadFixtures";

export type RuntimeServiceId = "core" | "harbor";
export type RuntimeProcessState = "not_configured" | "starting" | "running" | "exited" | "failed";
export type RuntimeProbeState = "ready" | "unavailable";

export type RuntimeProbe = {
  state: RuntimeProbeState;
  url: string;
  statusCode?: number;
  summary: string;
  attempts?: Array<{ url: string; statusCode?: number; summary: string }>;
};

export type RuntimeServiceState = {
  id: RuntimeServiceId;
  name: string;
  endpoint: string;
  processState: RuntimeProcessState;
  launchSource: "env-command" | "env-path" | "packaged-path" | "local-cwd" | "not_configured";
  command?: string;
  cwd?: string;
  pid?: number;
  health: RuntimeProbe;
  admission?: RuntimeProbe;
  checkedAt: string;
  lastExitCode?: number | null;
  lastError?: string;
  repairAction: string;
};

export type LodeAssetBundleState = {
  state: "ready" | "missing" | "invalid";
  source: "env-path" | "packaged-path" | "build-output" | "not_configured";
  rootPath?: string;
  registryPath?: string;
  packageCount: number;
  requiredPackageRefs: string[];
  missingPackageRefs: string[];
  checkedAt: string;
  summary: string;
  consumerBoundary: string;
};

export type RuntimeSupervisorState = {
  mode: "real";
  checkedAt: string;
  services: RuntimeServiceState[];
  lodeAssets: LodeAssetBundleState;
  canUseLiveRuntime: boolean;
  failClosed: boolean;
  summary: string;
};

const runtimeSupervisorSource: OwnerSource = "App runtime supervisor";

export function runtimeSupervisorCheckingState(): RuntimeSupervisorState {
  const checkedAt = new Date().toISOString();
  return {
    mode: "real",
    checkedAt,
    services: [],
    lodeAssets: runtimeBlockedLodeAssets(checkedAt, "Lode capability assets are still being checked."),
    canUseLiveRuntime: false,
    failClosed: true,
    summary: "正在检查本地 Core/Harbor runtime；检查完成前生产任务保持 fail closed。",
  };
}

export function runtimeSupervisorUnavailableState(summary: string): RuntimeSupervisorState {
  return {
    ...runtimeSupervisorCheckingState(),
    checkedAt: new Date().toISOString(),
    summary,
  };
}

export function runtimeSupervisorIsChecking(runtime: RuntimeSupervisorState) {
  return runtime.services.length === 0 && runtime.summary.startsWith("正在检查");
}

export function projectRuntimeGatedTasks(
  tasks: TaskProjection[],
  runtime: RuntimeSupervisorState,
  liveTaskIds: string[],
) {
  if (runtime.canUseLiveRuntime) {
    return tasks.map((task) => (liveTaskIds.includes(task.id) ? task : runtimeBlockedTask(task, runtime)));
  }

  return tasks.map((task) => runtimeBlockedTask(task, runtime));
}

export function projectRuntimeGatedIdentities(
  identities: IdentityEnvironmentProjection[],
  runtime: RuntimeSupervisorState,
) {
  const harborReady = runtime.services.some((service) => service.id === "harbor" && service.health.state === "ready");
  if (harborReady) {
    return identities.map((identity) =>
      identity.source === "Harbor live"
        ? identity
        : runtimeBlockedIdentity(identity, "Harbor live identity facts unavailable；fixture/demo identity 已隔离。"),
    );
  }

  return identities.map((identity) =>
    runtimeBlockedIdentity(
      identity,
      "Harbor runtime health 未通过；fixture/demo provider 不作为生产可用状态。",
    ),
  );
}

function runtimeBlockedIdentity(identity: IdentityEnvironmentProjection, reason: string) {
  return {
    ...identity,
    source: runtimeSupervisorSource,
    provider: {
      selected: "未可用" as const,
      role: "不可启动" as const,
      state: "blocked" as const,
      reason,
    },
    login: {
      ...identity.login,
      state: "未知" as const,
      recoveryRequired: true,
      manualAuthenticationState: "需要认证" as const,
      recoveryActions: ["启动 Harbor runtime 后刷新身份环境"],
      reason: "生产模式需要 Harbor owner facts；App 不使用 fixture 登录态。",
    },
    readiness: {
      state: "blocked" as const,
      label: "runtime 未连接",
      reasons: ["Harbor runtime health unavailable", "fixture/demo 已隔离，不能作为 provider、identity 或 session 可用证明。"],
    },
    browser: {
      ...identity.browser,
      providers: identity.browser.providers.map((provider) => ({
        ...provider,
        state: "missing" as const,
        statusLabel: "不可用",
        summary: "生产模式未通过 Harbor runtime health；fixture/demo provider 已隔离。",
      })),
      session: {
        ...identity.browser.session,
        state: "failed" as const,
        statusLabel: "不可用",
        controller: "空闲" as const,
        currentUrl: "runtime unavailable",
        title: "Harbor runtime 未连接",
        message: "App 不把 fixture browser session 显示成可查看、可接管或真实运行现场。",
      },
    },
    taskEntries: identity.taskEntries.map((entry) => ({
      ...entry,
      readiness: "生产运行已阻断；Core/Harbor health/admission 可用前不启动真实任务。",
      source: runtimeSupervisorSource,
    })),
  };
}

export function runtimeService(runtime: RuntimeSupervisorState, id: RuntimeServiceId) {
  return runtime.services.find((service) => service.id === id);
}

function runtimeBlockedTask(task: TaskProjection, runtime: RuntimeSupervisorState): TaskProjection {
  const gateRun = runtimeBlockedRun(task, runtime);
  let insertedGate = false;
  const runs = task.runs.flatMap((run) => {
    if (!runRequiresLiveRuntime(run)) return [run];
    if (insertedGate) return [];
    insertedGate = true;
    return [gateRun];
  });
  if (!insertedGate) return task;

  return {
    ...task,
    blocker: "生产运行已 fail closed：Core/Harbor runtime health/admission 未通过，App 不展示 fixture 结果、真实成功或可审批写前验证。",
    runs,
  };
}

export function runRequiresLiveRuntime(run: RunProjection) {
  return run.lifecycle === "queued" || run.lifecycle === "running" || run.lifecycle === "needs-action";
}

function runtimeBlockedRun(task: TaskProjection, runtime: RuntimeSupervisorState): RunProjection {
  const core = runtimeService(runtime, "core");
  const harbor = runtimeService(runtime, "harbor");
  const coreHealth = core?.health.state ?? "unavailable";
  const coreAdmission = core?.admission?.state ?? "unavailable";
  const harborHealth = harbor?.health.state ?? "unavailable";

  return {
    id: `runtime-blocked-${task.id}`,
    label: "Runtime gate",
    lifecycle: "blocked",
    outcome: "unavailable",
    summary: "生产运行已阻断：没有通过本地 Core health/admission 与 Harbor runtime health，fixture/demo 不显示为真实成功。",
    actionIntent: "Repair action: 启动或配置本地 Core 与 Harbor runtime，然后刷新运行状态。",
    owner: "Core",
    source: runtimeSupervisorSource,
    resultRows: [
      { label: "Core health", value: coreHealth, source: runtimeSupervisorSource },
      { label: "Core admission", value: coreAdmission, source: runtimeSupervisorSource },
      { label: "Harbor health", value: harborHealth, source: runtimeSupervisorSource },
      { label: "Core health endpoint", value: core?.health.url ?? "not checked", source: runtimeSupervisorSource },
      { label: "Core admission endpoint", value: core?.admission?.url ?? "not checked", source: runtimeSupervisorSource },
      { label: "Harbor health endpoint", value: harbor?.health.url ?? "not checked", source: runtimeSupervisorSource },
      { label: "Lode assets", value: runtime.lodeAssets.state, source: runtimeSupervisorSource },
      { label: "Fixture/demo", value: "隔离；不作为可用任务、真实结果或写前验证成功", source: runtimeSupervisorSource },
    ],
    evidenceCards: [
      {
        id: `runtime-gate-${task.id}`,
        title: "Runtime fail-closed gate",
        summary: runtime.summary,
        viewerLabel: "No live evidence viewer",
        viewerHref: "#runtime-fail-closed",
        source: runtimeSupervisorSource,
        status: "unavailable",
        freshness: runtime.checkedAt,
        provenance: "Electron runtime supervisor",
      },
    ],
    capabilityAttribution: {
      capabilityRef: task.packageSource.capabilityRef,
      version: task.packageSource.version,
      sourceRef: task.packageSource.sourceRef,
      failureClass: "runtime",
      summary: "Capability fixture remains visible only as isolated metadata; Core live run projection is required before showing results.",
    },
    failureRecovery: {
      state: "runtime unavailable",
      reason: runtime.summary,
      nextActions: [
        core?.repairAction ?? "Configure Core runtime command/path.",
        harbor?.repairAction ?? "Configure Harbor runtime command/path.",
        runtime.lodeAssets.state === "ready"
          ? "Lode capability assets are available."
          : "Package or configure Lode local capability assets before enabling Core tasks.",
      ],
      source: runtimeSupervisorSource,
    },
    process: [
      `Core health: ${coreHealth}.`,
      `Core health probe: ${core?.health.summary ?? "not checked"}.`,
      `Core admission: ${coreAdmission}.`,
      `Core admission probe: ${core?.admission?.summary ?? "not checked"}.`,
      `Harbor health: ${harborHealth}.`,
      `Harbor health probe: ${harbor?.health.summary ?? "not checked"}.`,
      `Lode assets: ${runtime.lodeAssets.state}.`,
      "No fixture/demo projection was promoted to a usable real result.",
    ],
  };
}

function runtimeBlockedLodeAssets(checkedAt: string, summary: string): LodeAssetBundleState {
  return {
    state: "missing",
    source: "not_configured",
    packageCount: 0,
    requiredPackageRefs: [],
    missingPackageRefs: [],
    checkedAt,
    summary,
    consumerBoundary:
      "App only displays Lode asset availability; Core consumes package refs and Harbor/Core produce runtime/live evidence.",
  };
}
