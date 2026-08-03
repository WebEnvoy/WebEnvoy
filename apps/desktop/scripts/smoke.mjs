import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const requiredFiles = [
  "dist-electron/main.js",
  "dist-electron/preload.cjs",
  "dist-electron/runtime/harbor/node_modules/tar/package.json",
  "dist/renderer/index.html",
  "dist/renderer/assets",
];

for (const file of requiredFiles) {
  await access(file);
}

const mainSource = await readFile("dist-electron/main.js", "utf8");
const preloadSource = await readFile("dist-electron/preload.cjs", "utf8");
const runtimeSupervisorSource = await readFile("dist-electron/runtimeSupervisor.js", "utf8");
const packagedCoreRuntimeSource = await readFile("dist-electron/runtime/core/start-runtime.mjs", "utf8");
const packagedHarborRuntimeSource = await readFile("dist-electron/runtime/harbor/start-runtime.mjs", "utf8");
const packagedRuntimeState = JSON.parse(await readFile("dist-electron/runtime/packaging-state.json", "utf8"));
const runtimeSourceLock = JSON.parse(await readFile("scripts/runtime-source-lock.json", "utf8"));
const rendererHtml = await readFile("dist/renderer/index.html", "utf8");
const connectionConfigSource = await readFile("src/renderer/localConnectionConfig.ts", "utf8");
const coreReadTaskClientSource = await readFile("src/renderer/coreReadTaskClient.ts", "utf8");
const coreThreadClientSource = await readFile("src/renderer/coreThreadClient.ts", "utf8");
const coreThreadInputContractSource = await readFile("src/renderer/coreThreadInputContract.ts", "utf8");
const coreTaskSubmitClientSource = await readFile("src/renderer/coreTaskSubmitClient.ts", "utf8");
const identityEnvironmentFixturesSource = await readFile("src/renderer/identityEnvironmentFixtures.ts", "utf8");
const identityEnvironmentsPageSource = await readFile("src/renderer/IdentityEnvironmentsPage.tsx", "utf8");
const appSource = await readFile("src/renderer/App.tsx", "utf8");
const appControllerSource = await readFile("src/renderer/useAppController.ts", "utf8");
const appShellViewSource = await readFile("src/renderer/AppShellView.tsx", "utf8");
const appSourcesSource = await readFile("src/renderer/useAppSources.ts", "utf8");
const appTasksSource = await readFile("src/renderer/useAppTasks.ts", "utf8");
const createTaskShellSource = await readFile("src/renderer/CreateTaskShell.tsx", "utf8");
const taskThreadPageSource = await readFile("src/renderer/TaskThreadPage.tsx", "utf8");
const taskBusinessResultSource = await readFile("src/renderer/TaskBusinessResult.tsx", "utf8");
const coreRunResultClientSource = await readFile("src/renderer/coreRunResultClient.ts", "utf8");
const taskThreadRightPanelSource = await readFile("src/renderer/TaskThreadRightPanel.tsx", "utf8");
const shellPrimitivesSource = await readFile("src/renderer/shellPrimitives.tsx", "utf8");
const workbenchPreferencesSource = await readFile("src/renderer/workbenchPreferences.ts", "utf8");
const workbenchSidebarSource = await readFile("src/renderer/WorkbenchSidebar.tsx", "utf8");
const harborIdentityClientSource = await readFile("src/renderer/harborIdentityClient.ts", "utf8");
const harborIdentityProjectionSource = await readFile("src/renderer/harborIdentityProjection.ts", "utf8");
const harborIdentityRecoverySource = await readFile("src/renderer/harborIdentityRecovery.ts", "utf8");
const harborIdentityTypesSource = await readFile("src/renderer/harborIdentityTypes.ts", "utf8");
const harborIdentityMutationClientSource = await readFile("src/renderer/harborIdentityMutationClient.ts", "utf8");
const ownerApiClientSource = await readFile("src/renderer/ownerApiClient.ts", "utf8");
const ownerPayloadGuardsSource = await readFile("src/renderer/ownerPayloadGuards.ts", "utf8");
const runtimeSupervisorStateSource = await readFile("src/renderer/runtimeSupervisorState.ts", "utf8");
const manualAuthenticationCompletionModule = await import(
  pathToFileURL(path.resolve("dist-electron/manualAuthenticationCompletion.js")).href,
);
const ownerApiRequestModule = await import(
  pathToFileURL(path.resolve("dist-electron/ownerApiRequest.js")).href,
);
const runtimeSupervisorModule = await import(
  pathToFileURL(path.resolve("dist-electron/runtimeSupervisor.js")).href,
);
const rendererAssets = await readFile(
  "dist/renderer/assets/index.js",
  "utf8",
).catch(async () => {
  const { readdir } = await import("node:fs/promises");
  const assets = await readdir("dist/renderer/assets");
  const appAsset = assets.find((asset) => asset.endsWith(".js"));

  if (!appAsset) {
    throw new Error("Renderer smoke failed: bundled JS asset is missing.");
  }

  return readFile(`dist/renderer/assets/${appAsset}`, "utf8");
});

if (!mainSource.includes("webenvoy:shell-context")) {
  throw new Error("Electron main smoke failed: shell context IPC is missing.");
}

if (!mainSource.includes("webenvoy:runtime-supervisor-state")) {
  throw new Error("Electron main smoke failed: runtime supervisor IPC is missing.");
}

if (!mainSource.includes("webenvoy:lode-catalog")) {
  throw new Error("Electron main smoke failed: Lode catalog IPC is missing.");
}

if (!mainSource.includes("webenvoy:owner-api-json")) {
  throw new Error("Electron main smoke failed: owner API IPC is missing.");
}

if (!mainSource.includes("webenvoy:harbor-manual-authentication-completed")) {
  throw new Error("Electron main smoke failed: manual authentication IPC is missing.");
}

if (!runtimeSupervisorSource.includes("HARBOR_RUNTIME_SUPERVISOR_TOKEN") || !runtimeSupervisorSource.includes("randomBytes(32)")) {
  throw new Error("Electron supervisor smoke failed: shared Harbor/Core runtime supervisor token is missing.");
}

if (!packagedHarborRuntimeSource.includes("manual_authentication_supervisor_token: process.env.HARBOR_MANUAL_AUTH_SUPERVISOR_TOKEN")) {
  throw new Error("Packaged Harbor runtime smoke failed: manual-auth supervisor token was not forwarded to Harbor.");
}

if (
  !packagedCoreRuntimeSource.includes("createFileTaskThreadStore") ||
  !packagedCoreRuntimeSource.includes("taskThreadStore") ||
  !packagedCoreRuntimeSource.includes("createFileExecutionPolicyConfigStore") ||
  !packagedCoreRuntimeSource.includes("executionPolicyConfigStore") ||
  !packagedCoreRuntimeSource.includes("createFileAuthorizationDecisionStore") ||
  !packagedCoreRuntimeSource.includes("authorizationDecisionStore") ||
  !packagedCoreRuntimeSource.includes("createHttpHarborIdentityFactsReader") ||
  !packagedCoreRuntimeSource.includes("harborIdentityFactsReader") ||
  !packagedCoreRuntimeSource.includes('modes: { read: "auto", prepare: "confirm", commit: "confirm", destructive: "confirm" }')
) {
  throw new Error("Packaged Core runtime smoke failed: thread, policy, authorization, identity-facts, or default-policy wiring is missing.");
}

const expectedRuntimeHeads = {
  core: "2c401cf90c0cf7150e8156b904975cefaf435fa8",
  harbor: "f9e13311ccd3f80cf8ef54cb97245a42da49882b",
  lode: "1fbef74b4bf1b4f0a86aacd885386d7a62181207",
};
if (JSON.stringify(runtimeSourceLock) !== JSON.stringify(expectedRuntimeHeads) ||
  packagedRuntimeState.status !== "ready" || packagedRuntimeState.packaged?.length !== 2) {
  throw new Error("Packaged source-lock smoke failed: runtime or Lode assets were not produced from the pinned clean sources.");
}

const sharedSupervisorToken = "smoke-shared-runtime-supervisor-token";
const parentTokenEnvironment = {
  SAFE_PARENT_VALUE: "kept",
  HARBOR_RUNTIME_SUPERVISOR_TOKEN: "parent-runtime-token-must-not-win",
  HARBOR_MANUAL_AUTH_SUPERVISOR_TOKEN: "parent-manual-token-must-not-win",
};
const harborChildEnvironment = runtimeSupervisorModule.runtimeSupervisorChildEnvironment(
  "harbor",
  "packaged-path",
  { HARBOR_RUNTIME_PORT: "8788" },
  sharedSupervisorToken,
  parentTokenEnvironment,
);
const coreChildEnvironment = runtimeSupervisorModule.runtimeSupervisorChildEnvironment(
  "core",
  "packaged-path",
  { PORT: "8787" },
  sharedSupervisorToken,
  parentTokenEnvironment,
);
if (
  harborChildEnvironment.HARBOR_RUNTIME_SUPERVISOR_TOKEN !== sharedSupervisorToken ||
  coreChildEnvironment.HARBOR_RUNTIME_SUPERVISOR_TOKEN !== sharedSupervisorToken ||
  harborChildEnvironment.HARBOR_MANUAL_AUTH_SUPERVISOR_TOKEN !== sharedSupervisorToken ||
  coreChildEnvironment.HARBOR_MANUAL_AUTH_SUPERVISOR_TOKEN !== undefined ||
  harborChildEnvironment.SAFE_PARENT_VALUE !== "kept" ||
  coreChildEnvironment.SAFE_PARENT_VALUE !== "kept"
) {
  throw new Error("Electron supervisor smoke failed: Harbor/Core did not receive the same isolated supervisor token environment.");
}

for (const path of [
  "/runtime/identity-environment-mutations",
  "/runtime/identity-environments",
  "/runtime/identity-environment-sessions",
  "/runtime/sessions/identity-environment",
  "/identity-environment-sessions",
  "/runtime/sessions/session_opaque/lock",
  "/runtime/sessions/session_opaque/release",
  "/runtime/sessions/session_opaque/stop",
  "/runtime/sessions/session_opaque/read-operations",
  "/runtime/sessions/session_opaque/snapshot",
]) {
  const parsed = ownerApiRequestModule.parseOwnerApiRequest({
    base: "http://127.0.0.1:8788",
    path,
    method: "POST",
  });
  if (
    !parsed.ok ||
    !ownerApiRequestModule.isHarborSupervisorProtectedRequest(parsed) ||
    ownerApiRequestModule.harborSupervisorAuthorizationHeader(parsed, sharedSupervisorToken) !== `Bearer ${sharedSupervisorToken}`
  ) {
    throw new Error(`Owner API supervisor smoke failed: protected Harbor path did not receive bearer authorization: ${path}`);
  }
}

for (const request of [
  { path: "/runtime/identity-environments/identity-env%3Aowner%2Faccount", method: "PATCH" },
  { path: "/runtime/identity-environments/identity-env%3Aowner%2Faccount", method: "DELETE" },
]) {
  const parsed = ownerApiRequestModule.parseOwnerApiRequest({ base: "http://127.0.0.1:8788", ...request });
  if (
    !parsed.ok ||
    !ownerApiRequestModule.isHarborSupervisorProtectedRequest(parsed) ||
    ownerApiRequestModule.harborSupervisorAuthorizationHeader(parsed, sharedSupervisorToken) !== `Bearer ${sharedSupervisorToken}`
  ) {
    throw new Error(`Owner API supervisor smoke failed: protected Harbor path did not receive bearer authorization: ${request.method} ${request.path}`);
  }
}

for (const request of [
  { path: "/tasks", method: "POST" },
  { path: "/runtime/identity-environment-sessions", method: "GET" },
  { path: "/runtime/sessions/session_opaque", method: "GET" },
  { path: "/runtime/sessions/session_opaque/snapshots", method: "POST" },
]) {
  const parsed = ownerApiRequestModule.parseOwnerApiRequest({ base: "http://127.0.0.1:8788", ...request });
  if (
    !parsed.ok ||
    ownerApiRequestModule.isHarborSupervisorProtectedRequest(parsed) ||
    ownerApiRequestModule.harborSupervisorAuthorizationHeader(parsed, sharedSupervisorToken) !== undefined
  ) {
    throw new Error(`Owner API supervisor smoke failed: unprotected path received bearer authorization: ${request.method} ${request.path}`);
  }
}

for (const [request, expectedTimeout] of [
  [{ path: "/tasks", method: "POST" }, 65_000],
  [{ path: "/threads/thread_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/turns", method: "POST" }, 65_000],
  [{ path: "/execution-policy-configs/skill?skill_ref=lode%3A%2F%2Fsite-capability%2Ftest%40v1", method: "PUT" }, 5_000],
  [{ path: "/runtime/identity-environment-sessions", method: "POST" }, 20_000],
  [{ path: "/runtime/identity-environment-mutations", method: "POST" }, 20_000],
  [{ path: "/runtime/identity-environments", method: "POST" }, 20_000],
  [{ path: "/runtime/identity-environments/identity-env%3Aowner%2Faccount", method: "PATCH" }, 20_000],
  [{ path: "/runtime/identity-environments/identity-env%3Aowner%2Faccount", method: "DELETE" }, 20_000],
  [{ path: "/runtime/sessions/session_public/release", method: "POST" }, 20_000],
  [{ path: "/runtime/identity-environments", method: "GET" }, 5_000],
]) {
  const parsed = ownerApiRequestModule.parseOwnerApiRequest({ base: "http://127.0.0.1:8788", ...request });
  if (!parsed.ok || ownerApiRequestModule.ownerApiTimeoutMs(parsed) !== expectedTimeout) {
    throw new Error(`Electron owner API timeout smoke failed for ${request.method} ${request.path}.`);
  }
}

const authorizationDecisionRef = "authorization-decision:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
for (const request of [
  { path: `/authorization-decisions/${authorizationDecisionRef}`, method: "GET" },
  { path: `/authorization-decisions/${encodeURIComponent(authorizationDecisionRef)}`, method: "GET" },
  { path: `/authorization-decisions/${authorizationDecisionRef}/single-action`, method: "POST" },
]) {
  const parsed = ownerApiRequestModule.parseOwnerApiRequest({ base: "http://127.0.0.1:8788", ...request });
  if (!parsed.ok) throw new Error(`Owner API rejected a declared authorization-decision path: ${request.path}`);
}
for (const path of ["/authorization-decisions/password", "/authorization-decisions/not-a-ref/single-action"]) {
  if (ownerApiRequestModule.parseOwnerApiRequest({ base: "http://127.0.0.1:8788", path }).ok) {
    throw new Error(`Owner API accepted a malformed authorization-decision path: ${path}`);
  }
}

const projectedOwnerError = ownerApiRequestModule.projectOwnerApiError({
  error: {
    code: "identity_not_found",
    category: "owner_contract",
    retryable: false,
    message: "Bearer raw-secret",
    credential: "raw-secret",
  },
  token: "raw-secret",
});
if (
  JSON.stringify(projectedOwnerError) !== JSON.stringify({
    code: "identity_not_found",
    category: "owner_contract",
    retryable: false,
  }) ||
  ownerApiRequestModule.projectOwnerApiError({ error: { code: "Bearer raw-secret" } }) !== undefined
) {
  throw new Error("Electron owner API error projection exposed non-allowlisted or credential-bearing fields.");
}

const projectedIdentityMutationError = ownerApiRequestModule.projectHarborIdentityMutationErrorBody(
  "/runtime/identity-environment-mutations",
  {
    schema_version: "harbor-identity-environment-mutation/v1",
    operation: "edit",
    status: "rejected",
    identity_environment_ref: "identity-env_public",
    source_identity_environment_ref: null,
    record: { credential: "must-not-cross-ipc" },
    effects: { index: "unchanged", local_data: "unchanged", login_state: "unchanged" },
    failure: { code: "proxy_unreachable", retryable: true, recovery_actions: ["revise_configuration", "retry"] },
    public_boundary: { output: "status_and_redacted_refs_only", raw_material: "not_exposed" },
    token: "must-not-cross-ipc",
  },
);
if (
  projectedIdentityMutationError?.failure?.code !== "proxy_unreachable" ||
  "record" in projectedIdentityMutationError ||
  JSON.stringify(projectedIdentityMutationError).includes("must-not-cross-ipc") ||
  ownerApiRequestModule.projectHarborIdentityMutationErrorBody("/tasks", projectedIdentityMutationError) !== undefined
) {
  throw new Error("Electron identity mutation error projection lost recovery facts or exposed non-allowlisted fields.");
}

const splitOutputToken = "smoke-split-supervisor-token";
const splitOutputRedactor = runtimeSupervisorModule.createRuntimeOutputRedactor(splitOutputToken);
const splitOutputParts = [
  splitOutputRedactor.write(`before ${splitOutputToken.slice(0, 11)}`),
  splitOutputRedactor.write(`${splitOutputToken.slice(11)} after`),
  splitOutputRedactor.flush(),
];
const splitOutput = splitOutputParts.join("");
if (splitOutputParts.some((part) => part.includes(splitOutputToken)) || splitOutput !== "before [redacted] after") {
  throw new Error("Electron supervisor smoke failed: token split across runtime output chunks was exposed.");
}

const rotatedOutputToken = "smoke-rotated-supervisor-token";
const restartedOutputRedactor = runtimeSupervisorModule.createRuntimeOutputRedactor(rotatedOutputToken);
const restartedOutput = `${restartedOutputRedactor.write(`restart ${rotatedOutputToken}`)}${restartedOutputRedactor.flush()}`;
if (restartedOutput.includes(rotatedOutputToken) || restartedOutput !== "restart [redacted]") {
  throw new Error("Electron supervisor smoke failed: rotated supervisor token was exposed after restart.");
}

if (!preloadSource.includes("webenvoyShell")) {
  throw new Error("Preload smoke failed: shell bridge is missing.");
}

if (!preloadSource.includes("getRuntimeSupervisorState")) {
  throw new Error("Preload smoke failed: runtime supervisor bridge is missing.");
}

if (!preloadSource.includes("getLodeCatalog")) {
  throw new Error("Preload smoke failed: Lode catalog bridge is missing.");
}

if (!preloadSource.includes("requestOwnerJson")) {
  throw new Error("Preload smoke failed: owner API bridge is missing.");
}

if (!preloadSource.includes("completeHarborManualAuthentication")) {
  throw new Error("Preload smoke failed: narrow manual-authentication bridge is missing.");
}

if (
  preloadSource.includes("HARBOR_RUNTIME_SUPERVISOR_TOKEN") ||
  preloadSource.includes("HARBOR_MANUAL_AUTH_SUPERVISOR_TOKEN") ||
  preloadSource.includes("Authorization") ||
  rendererAssets.includes("HARBOR_RUNTIME_SUPERVISOR_TOKEN") ||
  rendererAssets.includes("HARBOR_MANUAL_AUTH_SUPERVISOR_TOKEN") ||
  rendererAssets.includes(sharedSupervisorToken)
) {
  throw new Error("Manual authentication smoke failed: supervisor token or authorization plumbing reached preload or renderer assets.");
}

if (rendererHtml.includes('src="/assets/') || rendererHtml.includes('href="/assets/')) {
  throw new Error("Renderer smoke failed: packaged assets still use absolute paths.");
}

if (!rendererHtml.includes("WebEnvoy App")) {
  throw new Error("Renderer smoke failed: WebEnvoy title is missing.");
}

if (!identityEnvironmentsPageSource.includes("openBrowser") || !identityEnvironmentsPageSource.includes("item.id === selected.siteId")) {
  throw new Error("Identity recovery smoke failed: authentication site launch does not prefer the selected identity site target.");
}

if (
  !identityEnvironmentsPageSource.includes("onHarborStateChange(retained)") ||
  !appShellViewSource.includes("onHarborStateChange={actions.onHarborStateChange}") ||
  !appControllerSource.includes("skillWorkbench.invalidateRequests();") ||
  !appControllerSource.includes("sources.setHarborIdentityState(state);")
) {
  throw new Error("Harbor identity refresh smoke failed: refreshed live identity state is not synchronized to App submit admission.");
}

if (
  !workbenchSidebarSource.includes('id: "work"') ||
  !workbenchSidebarSource.includes('id: "browser"') ||
  !workbenchSidebarSource.includes('id: "library"') ||
  !workbenchSidebarSource.includes("任务线程") ||
  !workbenchSidebarSource.includes("按站点技能") ||
  !workbenchSidebarSource.includes("按账号身份") ||
  !workbenchSidebarSource.includes("最近更新") ||
  !workbenchSidebarSource.includes("优先处理") ||
  !workbenchSidebarSource.includes("task.updatedAt") ||
  !workbenchSidebarSource.includes("context.siteSkillKey") ||
  !workbenchSidebarSource.includes("context.accountIdentityKey") ||
  !workbenchSidebarSource.includes("threadContext!.siteLabel") ||
  workbenchSidebarSource.includes("ownerRef.includes") ||
  !workbenchSidebarSource.includes('event.key === "Escape"') ||
  !workbenchSidebarSource.includes('"ArrowDown"') ||
  !workbenchSidebarSource.includes("onCreateTask")
) {
  throw new Error("Workbench shell smoke failed: approved domains or task-list organization controls are missing.");
}

if (
  !createTaskShellSource.includes("这次要让 WebEnvoy 完成什么？") ||
  createTaskShellSource.includes("opaqueTargetRef") ||
  !appSourcesSource.includes("fetchCoreThreadState") ||
  !appSourcesSource.includes("retainLastKnownCoreThreads") ||
  !appTasksSource.includes('task.runs.at(-1)?.id ?? ""') ||
  !appShellViewSource.includes("填写业务输入后即可提交第一个回合。") ||
  !coreThreadClientSource.includes('requestOwnerJson(endpoint, "/threads"') ||
  appSourcesSource.includes("fetchCoreReadTaskState(") ||
  appSourcesSource.includes("setInterval(refreshRuntimeSupervisor") ||
  !appSourcesSource.includes("setTimeout(refresh, 5000)") ||
  !appShellViewSource.includes("rightPanelOpenRequestKey={controller.tasks.rightPanelOpenRequestKey}") ||
  !appShellViewSource.includes("onOpenPreview={tasks.requestRightPanel}") ||
  !taskThreadPageSource.includes("data-workbench-open-right") ||
  !taskThreadPageSource.includes("onClick={onOpenPreview}") ||
  taskThreadPageSource.includes('?? "Harbor fixture"') ||
  taskThreadRightPanelSource.includes("sourceHealthFixture") ||
  taskThreadRightPanelSource.includes("Lode metadata fixture")
) {
  throw new Error("Workbench truth-boundary smoke failed: create mode, owner-thread, or production right-preview wiring regressed.");
}

const appSyntax = ts.createSourceFile("App.tsx", appSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const hasRuntimeTaskFixtureImport = appSyntax.statements.some((statement) =>
  ts.isImportDeclaration(statement) &&
  statement.moduleSpecifier.text === "./taskThreadFixtures" &&
  statement.importClause?.isTypeOnly !== true,
);
if (
  hasRuntimeTaskFixtureImport ||
  !identityEnvironmentsPageSource.includes('identity.source === "Harbor live"') ||
  appSourcesSource.includes("loadLocalIdentityEnvironmentDrafts") ||
  identityEnvironmentsPageSource.includes("localIdentityEnvironment") ||
  !identityEnvironmentsPageSource.includes("mutateHarborIdentityEnvironment")
) {
  throw new Error("Workbench owner isolation smoke failed: production shell still depends on task or identity fixture rows.");
}

if (
  !shellPrimitivesSource.includes("writeStoredRightPanelState") ||
  !shellPrimitivesSource.includes("moveFocusBeforePanelCollapse(") ||
  !shellPrimitivesSource.includes("[data-workbench-open-right]") ||
  !shellPrimitivesSource.includes('[data-focus-area="right-panel"][tabindex]')
) {
  throw new Error("Workbench panel smoke failed: right-panel persistence or focus restoration is missing.");
}

if (
  !workbenchPreferencesSource.includes("window.localStorage") ||
  !shellPrimitivesSource.includes("RIGHT_PANEL_OPEN_KEY_PREFIX") ||
  !shellPrimitivesSource.includes("workspaceScrollPositions") ||
  !shellPrimitivesSource.includes('role="separator"') ||
  !shellPrimitivesSource.includes('event.key === "ArrowRight"') ||
  !shellPrimitivesSource.includes("prefers-reduced-motion: reduce") &&
    !(await readFile("src/renderer/styles.css", "utf8")).includes("prefers-reduced-motion: reduce")
) {
  throw new Error("Workbench shell smoke failed: persisted layout, keyboard resize, or reduced-motion behavior is missing.");
}

if (!coreTaskSubmitClientSource.includes("intent_id: `intent_\${runId}`")) {
  throw new Error("Core task submit smoke failed: intent_id must remain a result-ref-safe opaque identifier.");
}

for (const expectedText of [
  "source-health",
  "WebEnvoy App 不作为运行事实真相源。",
  "Core-owned run navigation",
  "outcome:",
  "success",
  "empty",
  "partial",
  "failure-safe",
  "failure",
  "unavailable",
  "expired",
  "redacted",
  "unknown",
  "Owner-supported action intent",
  "Evidence card only links owner viewer refs",
  "raw evidence body",
  "当前仅展示 Core 线程绑定的 capability ref",
  "site_changed",
  "Status",
  "Freshness",
  "Provenance",
  "evidence_expired",
  "Work failure links back to capability health",
  "站点技能",
  "Source ref",
  "Lock ref",
  "Runtime session",
  "App 不使用无关本机浏览器现场代替任务现场",
  "真实页面写前验证",
  "No-submit guard",
  "page_changed",
  "pending",
  "expired",
  "blocked",
  "user_cancelled",
  "Submitted",
  "false",
  "submitted=false / 未提交",
  "No-submit guard",
  "账号身份",
  "管理账号、登录状态与独立浏览器环境。",
  "创建账号身份",
  "导入账号身份",
  "最近使用",
  "站点名称",
  "需要登录",
  "需要修复",
  "CloakBrowser",
  "官方 Chrome",
  "完整复制",
  "仅复制环境配置",
  "包含账号资料、登录状态和环境配置",
  "不包含账号资料和站点数据",
  "打开浏览器并登录",
  "接管",
  "已完成，继续",
  "放弃接管",
  "停止实例",
  "选择技能",
  "代理",
  "地区与语言",
  "指纹摘要",
  "高级环境信息",
  "检查环境依赖",
  "从 App 移除",
  "删除本机数据",
  "本机数据仍保留",
  "任务",
  "账号身份",
  "站点技能",
  "任务线程",
  "任务暂不可用",
  "暂无任务线程",
  "尚未创建账号身份",
  "站点技能暂不可用",
  "这次要让 WebEnvoy 完成什么？",
  "生产运行已阻断",
  "fixture/demo 不作为可用结果",
  "App runtime supervisor",
  "Harbor health",
  "Lode assets",
  "runtime 未连接",
]) {
  if (!rendererAssets.includes(expectedText)) {
    throw new Error(`Renderer smoke failed: ${expectedText} is missing.`);
  }
}

if (!taskThreadPageSource.includes("<TaskBusinessResult") || taskThreadPageSource.includes("Capability attribution") ||
  !taskBusinessResultSource.includes("business-result-table") || !taskBusinessResultSource.includes("findExactResultSkill") ||
  !taskBusinessResultSource.includes("data.normalized") || !taskBusinessResultSource.includes("exportCollectionRows") ||
  !taskBusinessResultSource.includes("没有匹配数据") || !taskBusinessResultSource.includes("执行状态待确认") ||
  !coreRunResultClientSource.includes("webenvoy.result-query.v0") || !coreRunResultClientSource.includes("payloadState !== \"available\"") ||
  !coreRunResultClientSource.includes("isForbiddenResultKey")) {
  throw new Error("Business result smoke failed: standard renderer, terminal states, or owner payload boundary is missing.");
}

const lodeAssetBundleModule = await import(
  pathToFileURL(path.resolve("dist-electron/lodeAssetBundle.js")).href
);
const lodeCatalogModule = await import(
  pathToFileURL(path.resolve("dist-electron/lodeCatalog.js")).href
);
const harborLaunch = runtimeSupervisorModule.resolveRuntimeServiceLaunchConfig(
  "harbor",
  { WEBENVOY_HARBOR_RUNTIME_CWD: "/tmp/harbor-runtime" },
  undefined,
);

if (
  harborLaunch?.command !== "pnpm" ||
  harborLaunch.args?.join(" ") !== "start:runtime" ||
  harborLaunch.cwd !== "/tmp/harbor-runtime" ||
  harborLaunch.source !== "local-cwd"
) {
  throw new Error("Runtime supervisor smoke failed: Harbor local start script config was not resolved.");
}

const readiness = runtimeSupervisorModule.summarizeRuntimeReadiness([
  {
    id: "core",
    name: "Core",
    endpoint: "http://127.0.0.1:8787",
    processState: "not_configured",
    launchSource: "not_configured",
    health: { state: "ready", url: "core/health", summary: "ready" },
    admission: { state: "unavailable", url: "core/admission", summary: "missing" },
    checkedAt: "smoke",
    repairAction: "repair core",
  },
  {
    id: "harbor",
    name: "Harbor",
    endpoint: "http://127.0.0.1:8788",
    processState: "not_configured",
    launchSource: "not_configured",
    health: { state: "ready", url: "harbor/health", summary: "ready" },
    checkedAt: "smoke",
    repairAction: "repair harbor",
  },
]);

if (!readiness.failClosed || readiness.canUseLiveRuntime) {
  throw new Error("Runtime supervisor smoke failed: missing Core admission did not fail closed.");
}

const lodeBundle = lodeAssetBundleModule.resolveLodeAssetBundle({}, undefined);

if (lodeBundle.state !== "ready" || lodeBundle.packageCount < 6 || lodeBundle.missingPackageRefs.length > 0) {
  throw new Error(`Lode asset bundle smoke failed: ${JSON.stringify(lodeBundle)}`);
}

const coreLodeEnv = lodeAssetBundleModule.coreLodeAssetEnvironment(lodeBundle);

if (!coreLodeEnv.WEBENVOY_LODE_ASSETS_PATH || !coreLodeEnv.WEBENVOY_LODE_REGISTRY_PATH) {
  throw new Error("Lode asset bundle smoke failed: Core env did not include asset paths.");
}

const lodeCatalog = lodeCatalogModule.readLodeCatalog(lodeBundle);
const xhsSearchSkill = lodeCatalog.skills.find((skill) => skill.packageRef.includes("/xiaohongshu/search-notes@"));
const bossSearchSkill = lodeCatalog.skills.find((skill) => skill.packageRef.includes("/boss/job-search@"));
if (
  lodeCatalog.status !== "ready" ||
  xhsSearchSkill?.availability !== "available" ||
  xhsSearchSkill.resultView?.mode !== "standard" ||
  xhsSearchSkill.resultView?.reason !== "not_declared" ||
  xhsSearchSkill.siteName !== "Xiaohongshu" ||
  xhsSearchSkill.name !== "Search Xiaohongshu notes" ||
  xhsSearchSkill.summary !== "Read Xiaohongshu search result cards from a logged-in browser page and return note refs for detail follow-up." ||
  xhsSearchSkill.actions[0]?.category !== "read" ||
  xhsSearchSkill.actions[0]?.resourceRequirementProfileIds?.length !== 1 ||
  xhsSearchSkill.actions[0].resourceRequirementProfileIds[0] !== "search-notes-logged-in-ready-page" ||
  !xhsSearchSkill.inputFields.some((field) =>
    field.id === "keyword" && field.label === "keyword" && field.required && field.minLength === 1 && field.maxLength === 80
  ) ||
  bossSearchSkill?.availability !== "incompatible" ||
  !bossSearchSkill.availabilityReason.includes("动作声明")
) {
  throw new Error(`Lode catalog projection smoke failed: ${JSON.stringify(lodeCatalog)}`);
}

const invalidBundleCatalog = lodeCatalogModule.readLodeCatalog({
  ...lodeBundle,
  state: "invalid",
  summary: "invalid bundle fixture",
});
if (invalidBundleCatalog.status !== "unavailable" || invalidBundleCatalog.skills.length > 0) {
  throw new Error(`Invalid Lode bundle was exposed as a usable catalog: ${JSON.stringify(invalidBundleCatalog)}`);
}

const damagedLodeRoot = await mkdtemp(path.join(tmpdir(), "webenvoy-lode-catalog-"));
try {
  await cp(lodeBundle.rootPath, damagedLodeRoot, { recursive: true });
  await rm(path.join(damagedLodeRoot, "sites/xiaohongshu/search-notes/schemas/input.schema.json"));
  const damagedCatalog = lodeCatalogModule.readLodeCatalog({
    ...lodeBundle,
    rootPath: damagedLodeRoot,
    registryPath: path.join(damagedLodeRoot, "registry/local-packages.json"),
  });
  const damagedSkill = damagedCatalog.skills.find((skill) => skill.packageRef.includes("/xiaohongshu/search-notes@"));
  const healthySkill = damagedCatalog.skills.find((skill) => skill.packageRef.includes("/xiaohongshu/read-note-detail@"));
  if (damagedCatalog.status !== "ready" || damagedSkill?.availability !== "incompatible" || healthySkill?.availability !== "available") {
    throw new Error(`Lode per-skill failure isolation smoke failed: ${JSON.stringify(damagedCatalog)}`);
  }
} finally {
  await rm(damagedLodeRoot, { recursive: true, force: true });
}

const symlinkedLodeRoot = await mkdtemp(path.join(tmpdir(), "webenvoy-lode-symlink-"));
try {
  await cp(lodeBundle.rootPath, symlinkedLodeRoot, { recursive: true });
  const queryPath = path.join(symlinkedLodeRoot, "registry/local-query.fixture.json");
  await rm(queryPath);
  await symlink(path.join(lodeBundle.rootPath, "registry/local-query.fixture.json"), queryPath);
  const symlinkedCatalog = lodeCatalogModule.readLodeCatalog({
    ...lodeBundle,
    rootPath: symlinkedLodeRoot,
    registryPath: path.join(symlinkedLodeRoot, "registry/local-packages.json"),
  });
  if (symlinkedCatalog.status !== "unavailable") {
    throw new Error(`Symlinked Lode query was not rejected: ${JSON.stringify(symlinkedCatalog)}`);
  }
} finally {
  await rm(symlinkedLodeRoot, { recursive: true, force: true });
}

const oversizedLodeRoot = await mkdtemp(path.join(tmpdir(), "webenvoy-lode-oversized-"));
try {
  await cp(lodeBundle.rootPath, oversizedLodeRoot, { recursive: true });
  await writeFile(
    path.join(oversizedLodeRoot, "registry/local-packages.json"),
    JSON.stringify({ padding: "x".repeat(2 * 1024 * 1024) }),
  );
  const oversizedBundle = lodeAssetBundleModule.resolveLodeAssetBundle(
    { WEBENVOY_LODE_ASSETS_PATH: oversizedLodeRoot },
    undefined,
  );
  if (oversizedBundle.state !== "invalid") {
    throw new Error(`Oversized Lode registry was not rejected: ${JSON.stringify(oversizedBundle)}`);
  }
} finally {
  await rm(oversizedLodeRoot, { recursive: true, force: true });
}

const missingDeclarationRoot = await mkdtemp(path.join(tmpdir(), "webenvoy-lode-missing-declaration-"));
try {
  await cp(lodeBundle.rootPath, missingDeclarationRoot, { recursive: true });
  const registryPath = path.join(missingDeclarationRoot, "registry/local-packages.json");
  const registry = JSON.parse(await readFile(registryPath, "utf8"));
  const searchEntry = registry.entries.find((entry) => entry.package_ref === "lode://site-capability/xiaohongshu/search-notes@0.1.0");
  delete searchEntry.manifest_path;
  await writeFile(registryPath, JSON.stringify(registry));
  const missingDeclarationBundle = lodeAssetBundleModule.resolveLodeAssetBundle(
    { WEBENVOY_LODE_ASSETS_PATH: missingDeclarationRoot },
    undefined,
  );
  if (missingDeclarationBundle.state !== "invalid") {
    throw new Error(`Missing Lode path declaration was not rejected: ${JSON.stringify(missingDeclarationBundle)}`);
  }
} finally {
  await rm(missingDeclarationRoot, { recursive: true, force: true });
}

const futureOutputRoot = await mkdtemp(path.join(tmpdir(), "webenvoy-lode-future-output-"));
try {
  await cp(lodeBundle.rootPath, futureOutputRoot, { recursive: true });
  const outputPath = path.join(futureOutputRoot, "sites/xiaohongshu/search-notes/schemas/output.schema.json");
  const outputSchema = JSON.parse(await readFile(outputPath, "utf8"));
  outputSchema.properties.result_kind.const = "future_result_kind";
  await writeFile(outputPath, JSON.stringify(outputSchema));
  const futureOutputCatalog = lodeCatalogModule.readLodeCatalog({
    ...lodeBundle,
    rootPath: futureOutputRoot,
    registryPath: path.join(futureOutputRoot, "registry/local-packages.json"),
  });
  const futureOutputSkill = futureOutputCatalog.skills.find((skill) => skill.packageRef.includes("/xiaohongshu/search-notes@"));
  const unaffectedSkill = futureOutputCatalog.skills.find((skill) => skill.packageRef.includes("/xiaohongshu/read-note-detail@"));
  if (
    futureOutputCatalog.status !== "ready" ||
    futureOutputSkill?.availability !== "available" ||
    futureOutputSkill?.outputKind !== "future_result_kind" ||
    unaffectedSkill?.availability !== "available"
  ) {
    throw new Error(`Owner-declared future output kind was overridden by App semantics: ${JSON.stringify(futureOutputCatalog)}`);
  }
} finally {
  await rm(futureOutputRoot, { recursive: true, force: true });
}

const contractBindingRoot = await mkdtemp(path.join(tmpdir(), "webenvoy-lode-contract-binding-"));
try {
  await cp(lodeBundle.rootPath, contractBindingRoot, { recursive: true });
  const packageRef = "lode://site-capability/xiaohongshu/search-notes@0.1.0";
  const packageRoot = path.join(contractBindingRoot, "sites/xiaohongshu/search-notes");
  const manifestPath = path.join(packageRoot, "manifest.json");
  const lockPath = path.join(packageRoot, "package-lock.json");
  const catalogPath = path.join(packageRoot, "catalog-metadata.json");
  const requirementsPath = path.join(packageRoot, "resource-requirements.json");
  const inputPath = path.join(packageRoot, "schemas/input.schema.json");
  const outputPath = path.join(packageRoot, "schemas/output.schema.json");
  const queryPath = path.join(contractBindingRoot, "registry/local-query.fixture.json");
  const originals = new Map(await Promise.all([manifestPath, lockPath, catalogPath, requirementsPath, inputPath, outputPath, queryPath]
    .map(async (file) => [file, await readFile(file, "utf8")])));
  const readSkill = () => lodeCatalogModule.readLodeCatalog({
    ...lodeBundle,
    rootPath: contractBindingRoot,
    registryPath: path.join(contractBindingRoot, "registry/local-packages.json"),
  }).skills.find((skill) => skill.packageRef === packageRef);
  const expectIncompatible = (label) => {
    if (readSkill()?.availability !== "incompatible") throw new Error(`Lode ${label} drift remained usable.`);
  };
  const restore = async (file) => writeFile(file, originals.get(file));

  const manifest = JSON.parse(originals.get(manifestPath));
  manifest.action_declaration.actions[0].target_scope.target_types = ["wrong_target"];
  await writeFile(manifestPath, JSON.stringify(manifest));
  expectIncompatible("action target");
  await restore(manifestPath);

  for (const mutate of [
    (value) => { value.manifest_version = "lode.site-capability.manifest.v999"; },
    (value) => { value.package_type = "future-capability"; },
    (value) => { value.capability.lifecycle = "active"; },
  ]) {
    const versionedManifest = JSON.parse(originals.get(manifestPath));
    mutate(versionedManifest);
    await writeFile(manifestPath, JSON.stringify(versionedManifest));
    expectIncompatible("manifest contract version");
    await restore(manifestPath);
  }

  const requirements = JSON.parse(originals.get(requirementsPath));
  requirements.operation_ref = "lode://operation/wrong_operation";
  await writeFile(requirementsPath, JSON.stringify(requirements));
  expectIncompatible("resource requirement operation");
  await restore(requirementsPath);

  const schemaRequirements = JSON.parse(originals.get(requirementsPath));
  schemaRequirements.resource_requirement_profiles[0].input_binding.input_schema = "lode://schema/wrong";
  await writeFile(requirementsPath, JSON.stringify(schemaRequirements));
  expectIncompatible("resource requirement schema binding");
  await restore(requirementsPath);

  const boundaryRequirements = JSON.parse(originals.get(requirementsPath));
  boundaryRequirements.resource_requirement_profiles[0].operation_boundary = "validate_only";
  await writeFile(requirementsPath, JSON.stringify(boundaryRequirements));
  expectIncompatible("resource requirement operation boundary");
  await restore(requirementsPath);

  for (const requiredFields of [["url"], ["url", "missing_field"], ["url", "limit"]]) {
    const fieldRequirements = JSON.parse(originals.get(requirementsPath));
    fieldRequirements.resource_requirement_profiles[0].input_binding.required_input_fields = requiredFields;
    await writeFile(requirementsPath, JSON.stringify(fieldRequirements));
    expectIncompatible("resource requirement input fields");
    await restore(requirementsPath);
  }

  const catalogMetadata = JSON.parse(originals.get(catalogPath));
  catalogMetadata.operation_id = "wrong_operation";
  await writeFile(catalogPath, JSON.stringify(catalogMetadata));
  expectIncompatible("catalog operation");
  await restore(catalogPath);

  const catalogVersion = JSON.parse(originals.get(catalogPath));
  catalogVersion.schema_version = "lode.catalog-metadata.v999";
  await writeFile(catalogPath, JSON.stringify(catalogVersion));
  expectIncompatible("catalog schema version");
  await restore(catalogPath);

  const query = JSON.parse(originals.get(queryPath));
  for (const group of query.queries) {
    for (const result of group.results ?? []) if (result.package_ref === packageRef) result.operation_id = "wrong_operation";
  }
  await writeFile(queryPath, JSON.stringify(query));
  expectIncompatible("query operation");
  await restore(queryPath);

  for (const mutate of [
    (schema) => { schema.$schema = "https://json-schema.org/draft/2099-01/schema"; },
    (schema) => { schema["x-lode"].operation_ref = "lode://operation/wrong"; },
    (schema) => { schema["x-lode"].operation_mode = "validate_only"; },
  ]) {
    const input = JSON.parse(originals.get(inputPath));
    mutate(input);
    await writeFile(inputPath, JSON.stringify(input));
    expectIncompatible("input schema action binding");
    await restore(inputPath);
  }

  for (const mutate of [
    (lock) => { lock.schema_version = "lode.package-lock.v999"; },
    (lock) => { lock.locked_assets.find((asset) => asset.role === "input_schema").path = "schemas/wrong.json"; },
    (lock) => { lock.locked_assets.find((asset) => asset.role === "input_schema").ref = "lode://schema/wrong"; },
    (lock) => { lock.locked_assets.find((asset) => asset.role === "input_schema").version = "9.9.9"; },
    (lock) => { lock.locked_assets.push({ ...lock.locked_assets.find((asset) => asset.role === "input_schema") }); },
  ]) {
    const packageLock = JSON.parse(originals.get(lockPath));
    mutate(packageLock);
    await writeFile(lockPath, JSON.stringify(packageLock));
    expectIncompatible("package lock asset binding");
    await restore(lockPath);
  }

  for (const mutate of [
    (schema) => { schema.additionalProperties = true; },
    (schema) => { schema.required = schema.required.filter((field) => field !== "result_kind"); },
    (schema) => { schema["x-lode"].schema_version = "9.9.9"; },
    (schema) => { delete schema.properties.result_kind; },
    (schema) => { schema.properties.notes = { type: 42, required: "not-an-array", additionalProperties: "yes" }; },
    (schema) => { schema.properties.notes = { unknownKeyword: true }; },
    (schema) => { schema.properties.notes = { $ref: "https://example.test/remote-schema" }; },
    (schema) => { schema.properties.notes = { $ref: "#/$defs/missing" }; },
    (schema) => { schema.properties.notes = { type: "string", pattern: "^[a-z]*[a-y]*z$" }; },
  ]) {
    const output = JSON.parse(originals.get(outputPath));
    mutate(output);
    await writeFile(outputPath, JSON.stringify(output));
    expectIncompatible("output schema");
  }
  await restore(outputPath);
} finally {
  await rm(contractBindingRoot, { recursive: true, force: true });
}

const resultViewRoot = await mkdtemp(path.join(tmpdir(), "webenvoy-lode-result-view-"));
try {
  await cp(lodeBundle.rootPath, resultViewRoot, { recursive: true });
  const packageRoot = path.join(resultViewRoot, "sites/xiaohongshu/search-notes");
  const catalogPath = path.join(packageRoot, "catalog-metadata.json");
  const manifestPath = path.join(packageRoot, "manifest.json");
  const lockPath = path.join(packageRoot, "package-lock.json");
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const packageLock = JSON.parse(await readFile(lockPath, "utf8"));
  const resourceRef = "lode://result-view/xiaohongshu/search-notes/xiaohongshu.search-results@0.1.0";
  const resourcePath = "views/search-results.json";
  const resourceFile = path.join(packageRoot, resourcePath);
  const resourceContents = JSON.stringify({ schema_version: "webenvoy.result-view-resource.v0", component: "table" });
  const resourceDigest = createHash("sha256").update(resourceContents).digest("hex");
  await mkdir(path.dirname(resourceFile), { recursive: true });
  await writeFile(resourceFile, resourceContents);
  catalog.result_view = {
    status: "present",
    declaration_version: "0.1.0",
    view_id: "xiaohongshu.search-results",
    view_version: "0.1.0",
    resource_ref: resourceRef,
    resource_path: resourcePath,
    compatible_outputs: {
      schemas: [{
        schema_ref: "lode://schema/site-capability/xiaohongshu/search-notes/output@0.1.0",
        schema_version: "0.1.0",
      }],
    },
    integrity: { algorithm: "sha256", digest: resourceDigest },
    lock_ref: "lode://lock/site-capability/xiaohongshu/search-notes@0.1.0",
    fallback: "standard_renderer",
  };
  manifest.asset_refs.push({
    role: "result_view_resource",
    path: resourcePath,
    status: "present",
    resource_ref: resourceRef,
    resource_version: "0.1.0",
  });
  packageLock.locked_assets.push({
    role: "result_view_resource",
    path: resourcePath,
    ref: resourceRef,
    version: "0.1.0",
    sha256: resourceDigest,
  });
  await writeFile(catalogPath, JSON.stringify(catalog));
  await writeFile(manifestPath, JSON.stringify(manifest));
  await writeFile(lockPath, JSON.stringify(packageLock));
  const declaredViewCatalog = lodeCatalogModule.readLodeCatalog({
    ...lodeBundle,
    rootPath: resultViewRoot,
    registryPath: path.join(resultViewRoot, "registry/local-packages.json"),
  });
  const declaredViewSkill = declaredViewCatalog.skills.find((skill) => skill.packageRef.includes("/xiaohongshu/search-notes@"));
  if (
    declaredViewSkill?.availability !== "available" ||
    declaredViewSkill.resultView?.mode !== "skill" ||
    declaredViewSkill.resultView?.viewVersion !== "0.1.0"
  ) {
    throw new Error(`Compatible result-view declaration was not projected: ${JSON.stringify(declaredViewSkill)}`);
  }

  for (const [label, invalidContents] of [
    ["HTML", "<webenvoy-result-view></webenvoy-result-view>"],
    ["JSON scalar", JSON.stringify("table")],
    ["JSON array", JSON.stringify([{ component: "table" }])],
    ["binary", Buffer.from([0x00, 0xff, 0x57, 0x45, 0x42, 0x00, 0x80])],
  ]) {
    const invalidDigest = createHash("sha256").update(invalidContents).digest("hex");
    catalog.result_view.integrity.digest = invalidDigest;
    packageLock.locked_assets.at(-1).sha256 = invalidDigest;
    await writeFile(resourceFile, invalidContents);
    await writeFile(catalogPath, JSON.stringify(catalog));
    await writeFile(lockPath, JSON.stringify(packageLock));
    const invalidViewSkill = lodeCatalogModule.readLodeCatalog({
      ...lodeBundle,
      rootPath: resultViewRoot,
      registryPath: path.join(resultViewRoot, "registry/local-packages.json"),
    }).skills.find((skill) => skill.packageRef.includes("/xiaohongshu/search-notes@"));
    if (invalidViewSkill?.resultView?.mode !== "standard") {
      throw new Error(`${label} result-view resource did not fall back safely: ${JSON.stringify(invalidViewSkill)}`);
    }
  }

  await writeFile(resourceFile, JSON.stringify({ schema_version: "webenvoy.result-view-resource.v0", component: "tampered" }));
  const driftedViewSkill = lodeCatalogModule.readLodeCatalog({
    ...lodeBundle,
    rootPath: resultViewRoot,
    registryPath: path.join(resultViewRoot, "registry/local-packages.json"),
  }).skills.find((skill) => skill.packageRef.includes("/xiaohongshu/search-notes@"));
  if (driftedViewSkill?.resultView?.mode !== "standard") {
    throw new Error(`Result-view integrity drift did not fall back safely: ${JSON.stringify(driftedViewSkill)}`);
  }
  await rm(resourceFile, { force: true });
  const unreadableViewSkill = lodeCatalogModule.readLodeCatalog({
    ...lodeBundle,
    rootPath: resultViewRoot,
    registryPath: path.join(resultViewRoot, "registry/local-packages.json"),
  }).skills.find((skill) => skill.packageRef.includes("/xiaohongshu/search-notes@"));
  if (unreadableViewSkill?.resultView?.mode !== "standard") {
    throw new Error(`Unreadable result-view resource did not fall back safely: ${JSON.stringify(unreadableViewSkill)}`);
  }
  catalog.result_view.integrity.digest = resourceDigest;
  packageLock.locked_assets.at(-1).sha256 = resourceDigest;
  await writeFile(resourceFile, resourceContents);
  await writeFile(lockPath, JSON.stringify(packageLock));

  catalog.result_view.compatible_outputs.schemas[0].schema_ref =
    "lode://schema/site-capability/xiaohongshu/read-note-detail/output@0.1.0";
  await writeFile(catalogPath, JSON.stringify(catalog));
  const fallbackViewCatalog = lodeCatalogModule.readLodeCatalog({
    ...lodeBundle,
    rootPath: resultViewRoot,
    registryPath: path.join(resultViewRoot, "registry/local-packages.json"),
  });
  const fallbackViewSkill = fallbackViewCatalog.skills.find((skill) => skill.packageRef.includes("/xiaohongshu/search-notes@"));
  if (
    fallbackViewSkill?.availability !== "available" ||
    fallbackViewSkill.resultView?.mode !== "standard" ||
    fallbackViewSkill.resultView?.reason !== "incompatible"
  ) {
    throw new Error(`Incompatible result-view declaration did not fall back safely: ${JSON.stringify(fallbackViewSkill)}`);
  }
} finally {
  await rm(resultViewRoot, { recursive: true, force: true });
}

await assertPackagedRuntimeRequiredFailsClosed();

const liveReadiness = runtimeSupervisorModule.summarizeRuntimeReadiness(
  [
    {
      id: "core",
      name: "Core",
      endpoint: "http://127.0.0.1:8787",
      processState: "running",
      launchSource: "packaged-path",
      health: { state: "ready", url: "core/health", summary: "ready" },
      admission: { state: "ready", url: "core/admission", summary: "ready" },
      checkedAt: "smoke",
      repairAction: "ready",
    },
    {
      id: "harbor",
      name: "Harbor",
      endpoint: "http://127.0.0.1:8788",
      processState: "running",
      launchSource: "packaged-path",
      health: { state: "ready", url: "harbor/health", summary: "ready" },
      checkedAt: "smoke",
      repairAction: "ready",
    },
  ],
  lodeBundle,
);

if (!liveReadiness.canUseLiveRuntime || liveReadiness.failClosed) {
  throw new Error("Runtime supervisor smoke failed: ready Core/Harbor/Lode did not open live gate.");
}

const fixtureCore = await startJsonServer((pathname) =>
  ["/health", "/admission/health"].includes(pathname) ? { status: "ready" } : null,
);
const fixtureHarbor = await startJsonServer((pathname) =>
  pathname === "/readiness" ? { status: "ready", source: "fixture" } : null,
);
try {
  const fixtureState = await runtimeSupervisorModule.createRuntimeSupervisor().readState({
    coreEndpoint: fixtureCore.endpoint,
    harborEndpoint: fixtureHarbor.endpoint,
  });
  const harborHealth = fixtureState.services.find((service) => service.id === "harbor")?.health;
  if (harborHealth?.state !== "unavailable" || fixtureState.canUseLiveRuntime) {
    throw new Error(`Runtime supervisor smoke failed: fixture Harbor readiness opened live gate. ${JSON.stringify(fixtureState)}`);
  }
} finally {
  await fixtureCore.close();
  await fixtureHarbor.close();
}

const { outputText: connectionConfigModuleSource } = ts.transpileModule(connectionConfigSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
});
const connectionConfigModule = await import(
  `data:text/javascript;charset=utf-8,${encodeURIComponent(connectionConfigModuleSource)}`
);
const { outputText: harborIdentityTypesModuleSource } = ts.transpileModule(harborIdentityTypesSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
});
const harborIdentityTypesModuleUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(harborIdentityTypesModuleSource)}`;
const { outputText: ownerPayloadGuardsModuleSource } = ts.transpileModule(ownerPayloadGuardsSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
});
const ownerPayloadGuardsModuleUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(ownerPayloadGuardsModuleSource)}`;
const ownerPayloadGuardsModule = await import(ownerPayloadGuardsModuleUrl);
if (!ownerPayloadGuardsModule.fixtureOrDemoPayloadReason({ evidence_refs: ["harbor:evidence/x/smoke"] })) {
  throw new Error("Owner payload guard smoke failed: smoke refs in arrays were not rejected.");
}
for (const payload of [
  { runtime: "smoke" },
  { ordinary: { source_ref: "fixture" } },
  { metadata: "demo" },
]) {
  if (!ownerPayloadGuardsModule.fixtureOrDemoPayloadReason(payload)) {
    throw new Error(`Owner payload guard smoke failed: metadata fixture marker was accepted: ${JSON.stringify(payload)}`);
  }
}
let overDepthPayload = { source: "live" };
for (let depth = 0; depth < 9; depth += 1) overDepthPayload = { nested: overDepthPayload };
if (!ownerPayloadGuardsModule.fixtureOrDemoPayloadReason(overDepthPayload)?.includes("maximum metadata inspection depth exceeded")) {
  throw new Error("Owner payload guard smoke failed: payload beyond inspection depth was accepted.");
}
if (ownerPayloadGuardsModule.fixtureOrDemoPayloadReason({
  schema_version: "harbor-browser-provider-status/v0",
  providers: [
    {
      provider_id: "chrome_official",
      display_name: "Google Chrome",
      role: "restricted_fallback",
      install: { status: "installed", path: "/Applications/Google Chrome.app", version: "149.0.7827.201", launchability: "launchable", reason: null },
      limitations: ["仅在 CloakBrowser 缺失或不可用时作为受限后备。"],
      download_guide: { missing_impacts: ["本地 smoke 不能把官方 Chrome 用作备用 runtime。"] },
    },
  ],
  excluded_providers: [{ provider: "chromium", reason: "Chromium 仅保留为开发/测试内部实现，不进入用户可选 provider 管理。" }],
})) {
  throw new Error("Owner payload guard smoke failed: descriptive provider guidance was rejected as fixture evidence.");
}
const { outputText: rawOwnerApiClientModuleSource } = ts.transpileModule(ownerApiClientSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
});
const boundedJsonResponseModuleUrl = pathToFileURL(path.resolve("dist-electron/boundedJsonResponse.js")).href;
const ownerApiErrorProjectionModuleUrl = pathToFileURL(path.resolve("dist-electron/ownerApiErrorProjection.js")).href;
const ownerApiClientModuleSource = rawOwnerApiClientModuleSource
  .replace(/from "\.\.\/electron\/boundedJsonResponse";/, `from "${boundedJsonResponseModuleUrl}";`)
  .replace(/from "\.\.\/electron\/ownerApiErrorProjection";/, `from "${ownerApiErrorProjectionModuleUrl}";`);
const ownerApiClientModuleUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(ownerApiClientModuleSource)}`;
const ownerApiClientModule = await import(ownerApiClientModuleUrl);
const { outputText: identityEnvironmentFixturesModuleSource } = ts.transpileModule(identityEnvironmentFixturesSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
});
const identityEnvironmentFixturesModuleUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(identityEnvironmentFixturesModuleSource)}`;
const { outputText: harborIdentityRecoveryModuleSource } = ts.transpileModule(harborIdentityRecoverySource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
});
const harborIdentityRecoveryModuleUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(harborIdentityRecoveryModuleSource)}`;
const { outputText: harborIdentityProjectionModuleSource } = ts.transpileModule(harborIdentityProjectionSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
});
const harborIdentityProjectionModuleUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(
  harborIdentityProjectionModuleSource
    .replace(
      'from "./identityEnvironmentFixtures";',
      `from "${identityEnvironmentFixturesModuleUrl}";`,
    )
    .replace(
      'from "./harborIdentityRecovery";',
      `from "${harborIdentityRecoveryModuleUrl}";`,
    ),
)}`;
const harborIdentityProjectionModule = await import(harborIdentityProjectionModuleUrl);
const { outputText: harborIdentityClientModuleSource } = ts.transpileModule(harborIdentityClientSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
});
const harborIdentityClientModule = await import(
  `data:text/javascript;charset=utf-8,${encodeURIComponent(
    harborIdentityClientModuleSource
      .replace(
        'from "./harborIdentityProjection";',
        `from "${harborIdentityProjectionModuleUrl}";`,
      )
      .replace(
        'from "./harborIdentityTypes";',
        `from "${harborIdentityTypesModuleUrl}";`,
      )
      .replace(
        'from "./harborIdentityRecovery";',
        `from "${harborIdentityRecoveryModuleUrl}";`,
      )
      .replace(
        'from "./ownerPayloadGuards";',
        `from "${ownerPayloadGuardsModuleUrl}";`,
      )
      .replace(
        'from "./ownerApiClient";',
        `from "${ownerApiClientModuleUrl}";`,
      ),
  )}`
);
const { outputText: harborIdentityMutationClientModuleSource } = ts.transpileModule(harborIdentityMutationClientSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
});
const harborIdentityMutationClientModule = await import(
  `data:text/javascript;charset=utf-8,${encodeURIComponent(
    harborIdentityMutationClientModuleSource
      .replace('from "./ownerPayloadGuards";', `from "${ownerPayloadGuardsModuleUrl}";`)
      .replace('from "./ownerApiClient";', `from "${ownerApiClientModuleUrl}";`),
  )}`
);
const { outputText: coreReadTaskClientModuleSource } = ts.transpileModule(coreReadTaskClientSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
});
const coreReadTaskClientModuleRewritten = coreReadTaskClientModuleSource.replace(
  'from "./ownerPayloadGuards";',
  `from "${ownerPayloadGuardsModuleUrl}";`,
).replace(
  'from "./ownerApiClient";',
  `from "${ownerApiClientModuleUrl}";`,
) + "\nexport { typedCoreRefValueReason };";
const coreReadTaskClientModule = await import(
  `data:text/javascript;charset=utf-8,${encodeURIComponent(coreReadTaskClientModuleRewritten)}`
);
const { outputText: coreThreadInputContractModuleSource } = ts.transpileModule(coreThreadInputContractSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
});
const coreThreadInputContractModuleUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(coreThreadInputContractModuleSource)}`;
const { outputText: coreThreadClientModuleSource } = ts.transpileModule(coreThreadClientSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
});
const coreThreadClientModule = await import(
  `data:text/javascript;charset=utf-8,${encodeURIComponent(
    coreThreadClientModuleSource
      .replace(
        'from "./coreThreadInputContract";',
        `from "${coreThreadInputContractModuleUrl}";`,
      )
      .replace(
        'from "./ownerPayloadGuards";',
        `from "${ownerPayloadGuardsModuleUrl}";`,
      )
      .replace(
        'from "./ownerApiClient";',
        `from "${ownerApiClientModuleUrl}";`,
      ),
  )}`
);
const validCoreThreadEnvelope = {
  ok: true,
  threads: [
    {
      schema_version: "webenvoy.task-thread.v0",
      thread_id: "thread_11111111111111111111111111111111",
      capability_ref: "lode:capability/search-notes",
      identity_environment_ref: "identity-env:xhs/ops-a",
      created_at: "2026-07-20T08:00:00.000Z",
      updated_at: "2026-07-20T08:03:00.000Z",
      turns: [
        {
          turn_id: "turn_11111111111111111111111111111111",
          sequence: 1,
          idempotency_key: "idem-1",
          run_id: "run-owner-mcp",
          creation_channel: "mcp",
          input: {
            schema_version: "webenvoy.task-turn-input.v0",
            fields: [
              { field_id: "query", kind: "scalar", summary: "AI 工具" },
              { field_id: "source_url", kind: "url", summary: "https://example.test/path" },
            ],
            consumer_boundary: "Core stores bounded field summaries and owner refs only; raw content remains with its owner.",
          },
          created_at: "2026-07-20T08:01:00.000Z",
          updated_at: "2026-07-20T08:02:00.000Z",
          submission_state: "accepted",
          status: "completed",
          run_status: "succeeded",
          input_gaps: [],
          terminal_at: "2026-07-20T08:02:00.000Z",
        },
        {
          turn_id: "turn_22222222222222222222222222222222",
          sequence: 2,
          idempotency_key: "idem-2",
          run_id: "run-owner-app-cancelled",
          creation_channel: "app",
          input: {
            schema_version: "webenvoy.task-turn-input.v0",
            fields: [{ field_id: "draft", kind: "long_text", owner_ref: "draft:owner/2" }],
            attachment_refs: ["attachment:owner/2"],
            consumer_boundary: "Core stores bounded field summaries and owner refs only; raw content remains with its owner.",
          },
          created_at: "2026-07-20T08:02:30.000Z",
          updated_at: "2026-07-20T08:03:00.000Z",
          submission_state: "accepted",
          status: "cancelled",
          terminated_at: "2026-07-20T08:03:00.000Z",
        },
      ],
    },
    {
      schema_version: "webenvoy.task-thread.v0",
      thread_id: "thread_33333333333333333333333333333333",
      capability_ref: "lode:capability/custom-owner-skill",
      identity_environment_ref: "identity-env:owner/custom",
      created_at: "2026-07-20T07:00:00.000Z",
      updated_at: "2026-07-20T07:00:00.000Z",
      turns: [],
    },
  ],
};
const previousWindowForThreadSmoke = globalThis.window;
const previousFetchForThreadSmoke = globalThis.fetch;
globalThis.window = { clearTimeout: globalThis.clearTimeout, setTimeout: globalThis.setTimeout };
globalThis.fetch = async () => new Response(JSON.stringify(validCoreThreadEnvelope), {
  status: 200,
  headers: { "Content-Type": "application/json" },
});
const coreThreadState = await coreThreadClientModule.fetchCoreThreadState("http://core.test");
globalThis.fetch = async () => new Response(JSON.stringify({
  ...validCoreThreadEnvelope,
  threads: [{ ...validCoreThreadEnvelope.threads[0], schema_version: "webenvoy.task-thread.v1" }],
}), { status: 200, headers: { "Content-Type": "application/json" } });
const invalidCoreThreadState = await coreThreadClientModule.fetchCoreThreadState("http://core.test");
const validInputSnapshot = validCoreThreadEnvelope.threads[0].turns[0].input;
const invalidInputSnapshots = [
  { ...validInputSnapshot, fields: [{ field_id: "session_token", kind: "scalar", summary: "redacted" }] },
  { ...validInputSnapshot, fields: Array.from({ length: 65 }, (_, index) => ({ field_id: `field_${index}`, kind: "scalar", summary: "value" })) },
  { ...validInputSnapshot, fields: [
    { field_id: "query", kind: "scalar", summary: "first" },
    { field_id: "query", kind: "scalar", summary: "second" },
  ] },
  { ...validInputSnapshot, fields: [{ field_id: "query", kind: "scalar", summary: "value", owner_ref: "owner:value" }] },
  { ...validInputSnapshot, fields: [{ field_id: "draft", kind: "long_text", summary: "raw text", owner_ref: "draft:value" }] },
  { ...validInputSnapshot, fields: [{ field_id: "url", kind: "url", summary: "https://user:pass@example.test/path" }] },
  { ...validInputSnapshot, fields: [{ field_id: "url", kind: "url", summary: "https://example.test/path?query=value" }] },
  { ...validInputSnapshot, fields: [{ field_id: "url", kind: "url", summary: "https://example.test/path#section" }] },
  { ...validInputSnapshot, fields: [{ field_id: "url", kind: "url", summary: "ftp://example.test/path" }] },
  { ...validInputSnapshot, attachment_refs: Array.from({ length: 33 }, (_, index) => `attachment:item/${index}`) },
  { ...validInputSnapshot, attachment_refs: ["attachment:item/1", "attachment:item/1"] },
  { ...validInputSnapshot, fields: [{ field_id: "query", kind: "scalar", summary: "value", unexpected: true }] },
];
for (const input of invalidInputSnapshots) {
  globalThis.fetch = async () => new Response(JSON.stringify({
    ...validCoreThreadEnvelope,
    threads: [{
      ...validCoreThreadEnvelope.threads[0],
      turns: [{ ...validCoreThreadEnvelope.threads[0].turns[0], input }],
    }],
  }), { status: 200, headers: { "Content-Type": "application/json" } });
  const invalidInputState = await coreThreadClientModule.fetchCoreThreadState("http://core.test");
  if (invalidInputState.status !== "offline") {
    throw new Error(`Core thread input smoke failed: malformed persisted input was accepted: ${JSON.stringify(input)}`);
  }
}
const validThread = validCoreThreadEnvelope.threads[0];
const validTurn = validThread.turns[0];
const invalidThreadEnvelopes = [
  { ...validCoreThreadEnvelope, unexpected: true },
  { ...validCoreThreadEnvelope, threads: [{ ...validThread, unexpected: true }] },
  { ...validCoreThreadEnvelope, threads: [{ ...validThread, created_at: "2026-02-31T00:00:00Z" }] },
  { ...validCoreThreadEnvelope, threads: [{ ...validThread, created_at: "2026-07-20T24:00:00Z" }] },
  { ...validCoreThreadEnvelope, threads: [{ ...validThread, turns: [{ ...validTurn, turn_id: "turn_invalid" }] }] },
  { ...validCoreThreadEnvelope, threads: [{ ...validThread, turns: [{ ...validTurn, unexpected: true }] }] },
  { ...validCoreThreadEnvelope, threads: [{ ...validThread, turns: [{ ...validTurn, run_status: "completed" }] }] },
  { ...validCoreThreadEnvelope, threads: [{ ...validThread, turns: [{
    ...validTurn,
    submission_error: { category: "runtime", code: "failure", phase: "submit", recovery_hint: "retry", unexpected: true },
  }] }] },
  { ...validCoreThreadEnvelope, threads: [{ ...validThread, turns: [{
    ...validTurn,
    submission_error: { category: "x".repeat(129), code: "failure", phase: "submit", recovery_hint: "retry" },
  }] }] },
  { ...validCoreThreadEnvelope, threads: [{ ...validThread, turns: [{
    ...validTurn,
    input_gaps: [{ location: "cookie:0", code: "owner_ref_unavailable", recovery_action: "restore_owner_content" }],
  }] }] },
];
for (const envelope of invalidThreadEnvelopes) {
  globalThis.fetch = async () => new Response(JSON.stringify(envelope), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
  const invalidOuterState = await coreThreadClientModule.fetchCoreThreadState("http://core.test");
  if (invalidOuterState.status !== "offline") {
    throw new Error(`Core thread v0 smoke failed: malformed outer projection was accepted: ${JSON.stringify(envelope)}`);
  }
}
globalThis.fetch = previousFetchForThreadSmoke;
globalThis.window = previousWindowForThreadSmoke;
const projectedOwnerThread = coreThreadState.tasks[0];
const retainedOfflineThreadState = coreThreadClientModule.retainLastKnownCoreThreads(
  coreThreadState,
  coreThreadClientModule.unavailableCoreThreadState("http://core.test", "Core /threads unavailable."),
);
const submittedOverrideWhileOffline = coreThreadClientModule.mergeSubmittedCoreTaskOverrides(
  retainedOfflineThreadState,
  [{ taskId: projectedOwnerThread.id, task: { ...projectedOwnerThread, title: "must not replace owner state" } }],
);
const pendingSubmittedRun = projectedOwnerThread.runs[1];
const exactSubmittedPackageSource = {
  ...projectedOwnerThread.packageSource,
  version: "1.0.0",
  sourceRef: "lode://site-capability/xiaohongshu/search-notes@1.0.0",
};
const submittedOverrideBeforeOwnerCatchup = coreThreadClientModule.mergeSubmittedCoreTaskOverrides(
  {
    ...coreThreadState,
    tasks: [{ ...projectedOwnerThread, runs: projectedOwnerThread.runs.slice(0, 1) }, ...coreThreadState.tasks.slice(1)],
  },
  [{
    taskId: projectedOwnerThread.id,
    task: {
      ...projectedOwnerThread,
      title: "pending submitted run",
      packageSource: exactSubmittedPackageSource,
      runs: [pendingSubmittedRun],
    },
  }],
);
const submittedOverrideAfterOwnerCatchup = coreThreadClientModule.mergeSubmittedCoreTaskOverrides(
  coreThreadState,
  [{
    taskId: projectedOwnerThread.id,
    task: {
      ...projectedOwnerThread,
      title: "stale submitted run",
      packageSource: exactSubmittedPackageSource,
      runs: [pendingSubmittedRun],
    },
  }],
);
const submittedTerminalRun = {
  ...pendingSubmittedRun,
  turnStatus: "cancelled",
  updatedAt: "2026-07-20T10:00:01Z",
};
const submittedOverrideBeforeStateCatchup = coreThreadClientModule.mergeSubmittedCoreTaskOverrides(
  {
    ...coreThreadState,
    tasks: [{
      ...projectedOwnerThread,
      runs: [{
        ...pendingSubmittedRun,
        turnStatus: "running",
        updatedAt: "2026-07-20T10:00:00Z",
      }],
    }, ...coreThreadState.tasks.slice(1)],
  },
  [{
    taskId: projectedOwnerThread.id,
    task: {
      ...projectedOwnerThread,
      title: "newer submitted terminal state",
      packageSource: exactSubmittedPackageSource,
      runs: [submittedTerminalRun],
    },
  }],
);
if (
  coreThreadState.status !== "ready" ||
  coreThreadState.tasks.length !== 2 ||
  projectedOwnerThread?.id !== "thread_11111111111111111111111111111111" ||
  projectedOwnerThread.runs[0]?.creationChannel !== "mcp" ||
  projectedOwnerThread.runs[0]?.resultRows.some((row) => row.label === "创建渠道" && row.value === "MCP") !== true ||
  projectedOwnerThread.runs[1]?.turnStatus !== "cancelled" ||
  projectedOwnerThread.runs[1]?.creationChannel !== "app" ||
  projectedOwnerThread.runs[1]?.resultRows.some((row) => row.label === "创建渠道") ||
  !projectedOwnerThread.businessInput.includes("附件 1 个") ||
  coreThreadState.tasks[1]?.runs.length !== 0 ||
  invalidCoreThreadState.status !== "offline" ||
  retainedOfflineThreadState.liveTaskIds.length !== 0 ||
  submittedOverrideWhileOffline.status !== "offline" ||
  submittedOverrideWhileOffline.liveTaskIds.length !== 0 ||
  submittedOverrideWhileOffline.tasks[0]?.title === "must not replace owner state" ||
  submittedOverrideBeforeOwnerCatchup.tasks[0]?.title !== "pending submitted run" ||
  submittedOverrideAfterOwnerCatchup.tasks[0]?.title === "stale submitted run" ||
  submittedOverrideAfterOwnerCatchup.tasks[0]?.packageSource.version !== "1.0.0" ||
  submittedOverrideAfterOwnerCatchup.tasks[0]?.packageSource.sourceRef !== "lode://site-capability/xiaohongshu/search-notes@1.0.0" ||
  submittedOverrideBeforeStateCatchup.tasks[0]?.title !== "newer submitted terminal state"
) {
  throw new Error("Core thread projection smoke failed: owner schema, terminal state, submitted-run catch-up, empty thread, input validation, or offline fail-closed behavior regressed.");
}
for (const [value, kind] of [
  ["source_wrong_type", "session"],
  ["https://example.test/session_live", "session"],
  ["evidence_cookie_dump", "evidence"],
  ["evidence_raw_dom", "evidence"],
  ["evidence_har_capture", "evidence"],
  ["screenshot_token", "evidence"],
  ["result:core/xiaohongshu/password", "result"],
  [42, "source"],
]) {
  if (!coreReadTaskClientModule.typedCoreRefValueReason(value, kind, "smoke.ref", true)) {
    throw new Error(`Core ref guard smoke failed: unsafe or wrongly typed ${kind} ref was accepted: ${String(value)}`);
  }
}
for (const [value, kind] of [
  ["session_f76393db-e74f-4bec-88be-63754f7a5d00", "session"],
  ["source_6f45e8c0", "source"],
  ["evidence_6f45e8c0", "evidence"],
  ["screenshot_f65fac74-c1e8-4285-8015-ac8e22eb7d76", "evidence"],
  ["post_check_1c29bb68-10e4-458f-b384-97f249e711e9", "post-check"],
  ["result:core/xiaohongshu/search-notes/live", "result"],
]) {
  if (coreReadTaskClientModule.typedCoreRefValueReason(value, kind, "smoke.ref", true)) {
    throw new Error(`Core ref guard smoke failed: valid ${kind} ref was rejected: ${value}`);
  }
}
const { outputText: runtimeSupervisorStateModuleSource } = ts.transpileModule(runtimeSupervisorStateSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
});
const runtimeSupervisorStateModuleUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(runtimeSupervisorStateModuleSource)}`;
const runtimeSupervisorStateModule = await import(runtimeSupervisorStateModuleUrl);
const coreReadTaskClientModuleUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(coreReadTaskClientModuleRewritten)}`;
const { outputText: coreTaskSubmitClientModuleSource } = ts.transpileModule(coreTaskSubmitClientSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
});
const coreTaskSubmitClientModule = await import(
  `data:text/javascript;charset=utf-8,${encodeURIComponent(
    coreTaskSubmitClientModuleSource
      .replace(
        'from "./coreReadTaskClient";',
        `from "${coreReadTaskClientModuleUrl}";`,
      )
      .replace(
        'from "./runtimeSupervisorState";',
        `from "${runtimeSupervisorStateModuleUrl}";`,
      )
      .replace(
        'from "./ownerApiClient";',
        `from "${ownerApiClientModuleUrl}";`,
      ),
  )}`
);

const runtimeGateProjection = runtimeSupervisorStateModule.projectRuntimeGatedTasks(
  [{
    id: "task-live-history",
    title: "Live history",
    accountIdentity: "Harbor identity",
    siteSkill: "Owner capability",
    businessInput: "owner input",
    source: "Core live",
    packageSource: {
      name: "owner package",
      version: "1",
      capabilityRef: "lode:capability/owner",
      sourceRef: "lode://site-capability/owner@1",
      fetchedAt: "now",
      source: "Core live",
      boundary: "owner refs only",
    },
    runs: [
      { id: "run-terminal", label: "terminal", lifecycle: "completed", outcome: "success", summary: "done", actionIntent: "none", owner: "Core", source: "Core live", resultRows: [], evidenceCards: [], process: [] },
      { id: "run-active", label: "active", lifecycle: "running", outcome: "unknown", summary: "running", actionIntent: "wait", owner: "Core", source: "Core live", resultRows: [], evidenceCards: [], process: [] },
    ],
  }],
  runtimeSupervisorStateModule.runtimeSupervisorUnavailableState("offline"),
  ["task-live-history"],
);
const readyRuntimeWithOfflineThreads = runtimeSupervisorStateModule.projectRuntimeGatedTasks(
  runtimeGateProjection.map((task) => ({
    ...task,
    runs: [
      { id: "run-terminal", label: "terminal", lifecycle: "completed", outcome: "success", summary: "done", actionIntent: "none", owner: "Core", source: "Core live", resultRows: [], evidenceCards: [], process: [] },
      { id: "run-active", label: "active", lifecycle: "running", outcome: "unknown", summary: "running", actionIntent: "wait", owner: "Core", source: "Core live", resultRows: [], evidenceCards: [], process: [] },
    ],
  })),
  { ...runtimeSupervisorStateModule.runtimeSupervisorUnavailableState("health ready while /threads is offline"), canUseLiveRuntime: true, failClosed: false },
  [],
);
if (
  runtimeGateProjection[0]?.source !== "Core live" ||
  runtimeGateProjection[0]?.runs.some((run) => run.id === "run-terminal") !== true ||
  runtimeGateProjection[0]?.runs.some((run) => run.id === "run-active") ||
  runtimeGateProjection[0]?.runs.some((run) => run.id === "runtime-blocked-task-live-history") !== true ||
  readyRuntimeWithOfflineThreads[0]?.runs.some((run) => run.id === "run-terminal") !== true ||
  readyRuntimeWithOfflineThreads[0]?.runs.some((run) => run.id === "run-active") ||
  readyRuntimeWithOfflineThreads[0]?.runs.some((run) => run.id === "runtime-blocked-task-live-history") !== true
) {
  throw new Error("Runtime task projection smoke failed: terminal owner truth was overwritten or active work was unlocked after /threads went offline.");
}

function installLocalStorage(entries = {}) {
  const store = new Map(Object.entries(entries));

  globalThis.window = {
    clearTimeout: globalThis.clearTimeout,
    localStorage: {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => store.set(key, value),
    },
    setTimeout: globalThis.setTimeout,
  };

  return store;
}

installLocalStorage({
  [connectionConfigModule.localConnectionStorageKey]: "{broken",
});
const malformedConfig = connectionConfigModule.loadLocalConnectionConfig();

if (malformedConfig.coreEndpoint !== connectionConfigModule.defaultConnectionConfig.coreEndpoint) {
  throw new Error("Connection config smoke failed: malformed stored JSON did not fall back.");
}

const validStore = installLocalStorage();
const validSave = connectionConfigModule.saveLocalConnectionConfig({
  ...connectionConfigModule.defaultConnectionConfig,
  coreEndpoint: " http://localhost:3000/api/ ",
});

if (!validSave.ok || validSave.config.coreEndpoint !== "http://localhost:3000/api") {
  throw new Error("Connection config smoke failed: valid endpoint was not sanitized and saved.");
}

if (!validStore.has(connectionConfigModule.localConnectionStorageKey)) {
  throw new Error("Connection config smoke failed: valid endpoint did not write localStorage.");
}

const sensitiveStore = installLocalStorage();
const sensitiveSave = connectionConfigModule.saveLocalConnectionConfig({
  ...connectionConfigModule.defaultConnectionConfig,
  coreEndpoint: "https://example.test/profile",
});

if (sensitiveSave.ok || sensitiveStore.has(connectionConfigModule.localConnectionStorageKey)) {
  throw new Error("Connection config smoke failed: sensitive endpoint was saved.");
}

const projectedHarborIdentity = harborIdentityProjectionModule.projectHarborIdentity(
  harborIdentityFacts(),
  harborProviderCatalog(),
  "2026-07-20T08:00:00Z",
);
if (projectedHarborIdentity.source !== "Harbor live" || projectedHarborIdentity.taskEntries.length !== 0) {
  throw new Error("Harbor identity projection smoke failed: live identity exposed fixture task entries.");
}

const harborContract = await startHarborIdentityContractServer();
let readyXhsIdentity;
let harborRuntimeSession;
try {
  const createPayload = await harborIdentityMutationClientModule.mutateHarborIdentityEnvironment(harborContract.endpoint, {
    operation: "create",
    identity_environment: {
      site: { site_id: "xiaohongshu", origin: "https://www.xiaohongshu.com", display_name: "小红书", account_identifier: "运营号 smoke" },
      requested_provider_id: "cloakbrowser",
      language: "zh-CN",
      timezone: "Asia/Shanghai",
      viewport: "1440 x 900",
    },
  });
  if (createPayload.ok !== true) {
    throw new Error(`Harbor identity contract smoke failed: create was not accepted: ${JSON.stringify(createPayload)}`);
  }
  if ("record" in createPayload.result) {
    throw new Error("Harbor identity contract smoke failed: mutation client exposed the owner public record instead of the redacted result projection.");
  }

  const harborReadback = await harborIdentityClientModule.fetchHarborIdentityState(harborContract.endpoint);
  readyXhsIdentity = harborReadback.identities.find((identity) => identity.identityEnvironmentRef === "harbor://identity-environment/xhs-contract");
  if (harborReadback.status !== "ready" || readyXhsIdentity?.source !== "Harbor live" || readyXhsIdentity.readiness.state !== "needs-auth") {
    throw new Error(`Harbor identity contract smoke failed: initial readback did not require manual authentication: ${JSON.stringify(harborReadback)}`);
  }

  harborRuntimeSession = await harborIdentityClientModule.openHarborIdentitySession(
    harborContract.endpoint,
    readyXhsIdentity,
    readyXhsIdentity.browser.targets[0],
  );
  if ("status" in harborRuntimeSession || harborRuntimeSession.lifecycle_state !== "active") {
    throw new Error(`Harbor identity contract smoke failed: session was not active: ${JSON.stringify(harborRuntimeSession)}`);
  }

  const controlledSession = harborIdentityClientModule.projectHarborSession(harborRuntimeSession, readyXhsIdentity.browser.session);
  const missingAuthorization = await manualAuthenticationCompletionModule.requestManualAuthenticationCompletion({
    base: harborContract.endpoint,
    runtimeSessionRef: controlledSession.browserSessionRef,
    supervisorToken: undefined,
  });
  if (missingAuthorization.ok || harborContract.manualAuthenticationRequests() !== 0) {
    throw new Error("Harbor manual authentication smoke failed: missing supervisor authorization did not fail closed before the request.");
  }

  const wrongAuthorization = await manualAuthenticationCompletionModule.requestManualAuthenticationCompletion({
    base: harborContract.endpoint,
    runtimeSessionRef: controlledSession.browserSessionRef,
    supervisorToken: "wrong-supervisor-token",
  });
  if (wrongAuthorization.ok || wrongAuthorization.status !== 403 || harborContract.manualAuthenticationRequests() !== 1) {
    throw new Error("Harbor manual authentication smoke failed: wrong supervisor authorization was accepted.");
  }

  const nonLocalAuthorization = await manualAuthenticationCompletionModule.requestManualAuthenticationCompletion({
    base: "http://example.test",
    runtimeSessionRef: controlledSession.browserSessionRef,
    supervisorToken: harborContract.manualAuthenticationToken,
  });
  if (nonLocalAuthorization.ok || harborContract.manualAuthenticationRequests() !== 1) {
    throw new Error("Harbor manual authentication smoke failed: non-local Harbor base was not rejected before the request.");
  }

  const priorShell = globalThis.window.webenvoyShell;
  globalThis.window.webenvoyShell = {
    completeHarborManualAuthentication: ({ base, runtimeSessionRef }) =>
      manualAuthenticationCompletionModule.requestManualAuthenticationCompletion({
        base,
        runtimeSessionRef,
        supervisorToken: harborContract.manualAuthenticationToken,
      }).then((result) => result.ok ? result.body : result),
  };
  const completedAuthentication = await harborIdentityClientModule.completeHarborManualAuthentication(
    harborContract.endpoint,
    readyXhsIdentity,
    controlledSession,
  );
  if (!completedAuthentication.ok || completedAuthentication.identity.login_state.manual_authentication_state !== "completed") {
    throw new Error(`Harbor manual authentication smoke failed: completion response was not accepted: ${JSON.stringify(completedAuthentication)}`);
  }
  if (
    harborContract.manualAuthenticationRequests() !== 2 ||
    harborContract.manualAuthenticationAuthorization() !== `Bearer ${harborContract.manualAuthenticationToken}` ||
    harborContract.manualAuthenticationBodyLength() !== 0 ||
    JSON.stringify(completedAuthentication).includes("credential-must-not-leak")
  ) {
    throw new Error("Harbor manual authentication smoke failed: completion request scope or response redaction was violated.");
  }
  const packagedRuntimeRefs = manualAuthenticationCompletionModule.redactPublicManualAuthenticationResponse(JSON.stringify({
    schema_version: "harbor-local-identity-environment-store/v0",
    identity_environment_ref: "identity-env-live-xhs-chrome-20260710",
    site: { site_id: "xiaohongshu" },
    refs: {
      execution_identity_ref: "identity-env-live-xhs-chrome-20260710:execution",
      profile_ref: "profile-live-xhs-chrome-20260710",
    },
    status: {
      readiness: "ready",
      login_state: "logged_in",
      authentication_provenance: "user_confirmed_managed_session",
      browser_storage_state: "present",
      manual_authentication_state: "completed",
      recovery_required: false,
    },
  }));
  if (
    packagedRuntimeRefs?.identity_environment_ref !== "identity-env-live-xhs-chrome-20260710" ||
    packagedRuntimeRefs.refs?.execution_identity_ref !== "identity-env-live-xhs-chrome-20260710:execution" ||
    manualAuthenticationCompletionModule.redactPublicManualAuthenticationResponse(JSON.stringify({
      ...packagedRuntimeRefs,
      identity_environment_ref: "identity env with spaces",
    })) !== null
  ) {
    throw new Error("Harbor manual authentication smoke failed: packaged opaque refs were rejected or unsafe refs were accepted.");
  }
  const legacyRuntimeRefs = manualAuthenticationCompletionModule.redactPublicManualAuthenticationResponse(JSON.stringify({
    ...packagedRuntimeRefs,
    identity_environment_ref: "harbor://identity-environment/xhs-legacy",
    refs: {
      execution_identity_ref: "harbor://execution-identity/xhs-legacy",
      profile_ref: "harbor://profile/xhs-legacy",
    },
  }));
  if (!legacyRuntimeRefs) {
    throw new Error("Harbor manual authentication smoke failed: legacy typed public refs were rejected.");
  }
  for (const [label, change] of [
    ["identity wrong namespace", { identity_environment_ref: "profile-wrong" }],
    ["identity URL", { identity_environment_ref: "https://example.test/identity-env-live" }],
    ["identity sensitive fragment", { identity_environment_ref: "identity-env-token-secret" }],
    ["execution wrong namespace", { refs: { ...packagedRuntimeRefs.refs, execution_identity_ref: "execution-live-xhs" } }],
    ["execution sensitive fragment", { refs: { ...packagedRuntimeRefs.refs, execution_identity_ref: "identity-env-cookie:execution" } }],
    ["profile wrong namespace", { refs: { ...packagedRuntimeRefs.refs, profile_ref: "identity-env-live" } }],
    ["profile sensitive fragment", { refs: { ...packagedRuntimeRefs.refs, profile_ref: "profile-raw_evidence" } }],
  ]) {
    const rejected = manualAuthenticationCompletionModule.redactPublicManualAuthenticationResponse(JSON.stringify({
      ...packagedRuntimeRefs,
      ...change,
    }));
    if (rejected !== null) {
      throw new Error(`Harbor manual authentication smoke failed: ${label} was accepted.`);
    }
  }

  const refreshedHarborReadback = await harborIdentityClientModule.fetchHarborIdentityState(harborContract.endpoint);
  readyXhsIdentity = refreshedHarborReadback.identities.find((identity) => identity.identityEnvironmentRef === "harbor://identity-environment/xhs-contract");
  if (
    readyXhsIdentity?.readiness.state !== "ready" ||
    readyXhsIdentity.login.manualAuthenticationState !== "已完成" ||
    readyXhsIdentity.admissionFacts?.authenticationProvenance !== "user_confirmed_managed_session" ||
    !readyXhsIdentity.login.reason.includes("用户在 Harbor 受控会话中明确确认")
  ) {
    throw new Error(`Harbor manual authentication smoke failed: refreshed public identity was not ready: ${JSON.stringify(refreshedHarborReadback)}`);
  }

  const rejectedManualAuthentication = await harborIdentityClientModule.completeHarborManualAuthentication(
    harborContract.endpoint,
    { ...readyXhsIdentity, source: "App local-only" },
    controlledSession,
  );
  if (rejectedManualAuthentication.ok || harborContract.manualAuthenticationRequests() !== 2) {
    throw new Error("Harbor manual authentication smoke failed: local-only identity did not fail closed before the owner request.");
  }

  globalThis.window.webenvoyShell = {
    requestOwnerJson: (request) => ownerApiRequestModule.parseOwnerApiRequest(request),
  };
  const fallbackCompletion = await harborIdentityClientModule.completeHarborManualAuthentication(
    harborContract.endpoint,
    readyXhsIdentity,
    controlledSession,
  );
  if (fallbackCompletion.ok || harborContract.manualAuthenticationRequests() !== 2) {
    throw new Error("Harbor manual authentication smoke failed: renderer fallback could mark authentication completed.");
  }

  const genericCompletion = await ownerApiClientModule.requestOwnerJson(
    harborContract.endpoint,
    `/runtime/sessions/${encodeURIComponent(controlledSession.browserSessionRef)}/manual%2Dauthentication%2Dcompleted`,
    { method: "POST" },
  );
  if (genericCompletion.ok !== false || harborContract.manualAuthenticationRequests() !== 2) {
    throw new Error("Harbor manual authentication smoke failed: encoded generic owner API bypass sent a request.");
  }
  globalThis.window.webenvoyShell = priorShell;

  const previousOwnerFetch = globalThis.fetch;
  globalThis.window.webenvoyShell = undefined;
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: {
      category: "owner_contract",
      code: "identity_not_ready",
      message: "Bearer raw-secret",
      credential: "raw-secret",
    },
    token: "raw-secret",
  }), { status: 409, headers: { "content-type": "application/json" } });
  try {
    const browserOwnerError = await ownerApiClientModule.requestOwnerJson(
      harborContract.endpoint,
      "/runtime/identity-environments",
    );
    const serializedError = JSON.stringify(browserOwnerError);
    if (
      browserOwnerError?.error !== "/runtime/identity-environments returned 409: owner_contract: identity_not_ready" ||
      /raw-secret|Bearer|credential|token/.test(serializedError)
    ) {
      throw new Error(`Browser owner error projection exposed raw owner data: ${serializedError}`);
    }
  } finally {
    globalThis.fetch = previousOwnerFetch;
    globalThis.window.webenvoyShell = priorShell;
  }

  let localOnlySessionFetchCalled = false;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    localOnlySessionFetchCalled = true;
    throw new Error("local-only identity must not call Harbor session endpoint");
  };
  try {
    const localOnlySession = await harborIdentityClientModule.openHarborIdentitySession(
      harborContract.endpoint,
      { ...readyXhsIdentity, source: "App local-only" },
      readyXhsIdentity.browser.targets[0],
    );
    if (!("status" in localOnlySession) || localOnlySessionFetchCalled) {
      throw new Error(`Harbor identity contract smoke failed: local-only session was not fail-closed before fetch: ${JSON.stringify(localOnlySession)}`);
    }
  } finally {
    globalThis.fetch = previousFetch;
  }
} finally {
  await harborContract.close();
}

const fixtureIdentityHarbor = await startJsonServer((pathname) =>
  pathname === "/runtime/browser-providers"
    ? { ...harborProviderCatalog(), source: "fixture" }
    : pathname === "/runtime/identity-environments"
      ? { items: [{ ...harborIdentityFacts(), source: "fixture" }] }
      : null,
);
try {
  const fixtureState = await harborIdentityClientModule.fetchHarborIdentityState(fixtureIdentityHarbor.endpoint);
  if (fixtureState.status !== "offline" || fixtureState.identities.some((identity) => identity.source === "Harbor live")) {
    throw new Error(`Harbor identity smoke failed: fixture identity payload was accepted as live. ${JSON.stringify(fixtureState)}`);
  }
} finally {
  await fixtureIdentityHarbor.close();
}

const liveRuntimeForSubmit = {
  canUseLiveRuntime: true,
  services: [
    { id: "core", health: { state: "ready" }, admission: { state: "ready" } },
    { id: "harbor", health: { state: "ready" } },
  ],
};
const readonlySubmitTask = {
  id: "task-xhs-real-read",
  threadContext: {
    siteLabel: "小红书",
    siteSkillKey: "lode:capability/search-notes",
    accountIdentityKey: readyXhsIdentity.identityEnvironmentRef,
  },
  title: "小红书搜索与笔记读取",
  accountIdentity: "小红书运营号 A",
  siteSkill: "小红书搜索和笔记读取",
  businessInput: "读取 https://www.xiaohongshu.com/explore/abc?xsec_token=url-ref-only",
  searchQuery: "AI 工具",
  packageSource: {
    lockRef: "lode://lock/site-capability/xiaohongshu/search-notes@0.1.0",
  },
  runs: [],
};
const submitReadiness = coreTaskSubmitClientModule.coreTaskSubmitReadiness(
  readonlySubmitTask,
  liveRuntimeForSubmit,
  [readyXhsIdentity],
);

if (!submitReadiness.ok) {
  throw new Error(`Core submit smoke failed: ready live identity was blocked: ${submitReadiness.reason}`);
}

if (Object.prototype.hasOwnProperty.call(submitReadiness.payload, "entrypoint")) {
  throw new Error("Core submit smoke failed: payload still has invalid top-level entrypoint.");
}

if (
  submitReadiness.payload.task_intent.schema_version !== "webenvoy.task-intent.v0" ||
  submitReadiness.payload.task_intent.entrypoint !== "app" ||
  submitReadiness.payload.task_intent.scope.target_type !== "site" ||
  submitReadiness.payload.task_intent.scope.target_ref !== "https://www.xiaohongshu.com/search_result?keyword=AI+%E5%B7%A5%E5%85%B7" ||
  submitReadiness.payload.public_query?.query !== "AI 工具" ||
  submitReadiness.payload.task_intent.input.summary !== readonlySubmitTask.title ||
  submitReadiness.payload.task_intent.resource_requirement_refs[0] !== "xiaohongshu.search-notes.resources" ||
  submitReadiness.payload.task_intent.resource_requirement_profile_id !== "search-notes-logged-in-ready-page" ||
  submitReadiness.payload.harbor.timeout_ms !== 60_000 ||
  submitReadiness.payload.task_intent.evidence_policy_ref !== "evidence-policy:refs-only"
) {
  throw new Error(`Core submit smoke failed: task intent payload is malformed: ${JSON.stringify(submitReadiness.payload)}`);
}
if (JSON.stringify(submitReadiness.payload).includes(readonlySubmitTask.businessInput)) {
  throw new Error("Core submit smoke failed: free-form businessInput leaked into the payload.");
}

const originalXhsRequirementProfile = coreReadTaskClientModule.coreReadTaskSpecs[0].resourceRequirementProfileId;
coreReadTaskClientModule.coreReadTaskSpecs[0].resourceRequirementProfileId = "";
try {
  const missingProfileReadiness = coreTaskSubmitClientModule.coreTaskSubmitReadiness(
    readonlySubmitTask,
    liveRuntimeForSubmit,
    [readyXhsIdentity],
  );
  if (missingProfileReadiness.ok || !missingProfileReadiness.reason.includes("resource requirement profile")) {
    throw new Error(`Core submit smoke failed: missing resource requirement profile did not fail closed: ${JSON.stringify(missingProfileReadiness)}`);
  }
} finally {
  coreReadTaskClientModule.coreReadTaskSpecs[0].resourceRequirementProfileId = originalXhsRequirementProfile;
}

for (const recoveryCode of [
  "runtime_session_busy",
  "launch_failed",
  "profile_locked",
  "provider_conflict",
  "fingerprint_conflict",
]) {
  const summary = coreTaskSubmitClientModule.coreTaskSubmitFailureSummary(
    { error: { code: recoveryCode } },
    "fallback",
  );
  if (summary !== "需要修复浏览器环境后重试。") {
    throw new Error(`Core submit smoke failed: ${recoveryCode} did not route to browser environment repair.`);
  }
}
if (coreTaskSubmitClientModule.coreTaskSubmitFailureSummary(
  { error: { code: "identity_auth_required" } },
  "fallback",
) !== "需要登录或完成人工认证后重试。") {
  throw new Error("Core submit smoke failed: identity_auth_required did not preserve the authentication recovery route.");
}

const needsAuthReadiness = coreTaskSubmitClientModule.coreTaskSubmitReadiness(
  readonlySubmitTask,
  liveRuntimeForSubmit,
  [
    {
      ...readyXhsIdentity,
      login: { recoveryRequired: true },
      readiness: { state: "needs-auth" },
    },
  ],
);

if (needsAuthReadiness.ok) {
  throw new Error("Core submit smoke failed: needs-auth Harbor identity was accepted.");
}

for (const source of ["App local-only", "Harbor fixture"]) {
  const nonLiveReadiness = coreTaskSubmitClientModule.coreTaskSubmitReadiness(
    readonlySubmitTask,
    liveRuntimeForSubmit,
    [{ ...readyXhsIdentity, source }],
  );
  if (nonLiveReadiness.ok) {
    throw new Error(`Core submit smoke failed: ${source} identity was accepted as live.`);
  }
}

const restrictedChromeIdentity = {
  ...readyXhsIdentity,
  provider: { ...readyXhsIdentity.provider, selected: "官方 Chrome", role: "受限后备", state: "warning", reason: "official_chrome_fallback" },
  readiness: { state: "warning", label: "受限后备", reasons: ["official_chrome_fallback"] },
  admissionFacts: {
    providerId: "chrome_official",
    providerRole: "restricted_fallback",
    authenticationProvenance: "user_confirmed_managed_session",
    loginState: "logged_in",
    manualAuthenticationState: "completed",
    recoveryRequired: false,
    browserStorageState: "present",
    warningReasonCodes: [],
  },
};
const chromeFallbackReadiness = coreTaskSubmitClientModule.coreTaskSubmitReadiness(
  readonlySubmitTask,
  liveRuntimeForSubmit,
  [restrictedChromeIdentity],
);
if (!chromeFallbackReadiness.ok || chromeFallbackReadiness.identity.readiness.state !== "warning") {
  throw new Error("Core submit smoke failed: proven restricted Chrome fallback was not narrowly admitted with warning preserved.");
}
if (!coreTaskSubmitClientModule.isReadOnlyIdentityAdmitted(restrictedChromeIdentity, "xiaohongshu", coreReadTaskClientModule.coreReadTaskSpecs[0])) {
  throw new Error("Core submit smoke failed: exported identity admission disagrees with submit readiness.");
}

const readyBossIdentity = {
  ...readyXhsIdentity,
  siteId: "boss",
  origin: "https://www.zhipin.com",
  identityEnvironmentRef: "harbor://identity-environment/boss-contract",
};
const restrictedChromeBossIdentity = {
  ...restrictedChromeIdentity,
  siteId: "boss",
  origin: "https://www.zhipin.com",
  identityEnvironmentRef: "identity-env-live-boss-chrome-contract",
  admissionFacts: {
    ...restrictedChromeIdentity.admissionFacts,
    warningReasonCodes: ["proxy_missing"],
  },
};
const bossSearchTask = {
  ...readonlySubmitTask,
  id: "task-boss-real-read",
  threadContext: {
    siteLabel: "BOSS",
    siteSkillKey: "lode:capability/job-search",
    accountIdentityKey: restrictedChromeBossIdentity.identityEnvironmentRef,
  },
  title: "BOSS 职位搜索",
  siteSkill: "BOSS 职位搜索",
  businessInput: JSON.stringify({ query: "前端工程师", city_code: "101020100", page: 1, limit: 15 }),
  searchQuery: undefined,
  packageSource: { lockRef: "lode://lock/site-capability/boss/job-search@0.1.0" },
};
const bossReadiness = coreTaskSubmitClientModule.coreTaskSubmitReadiness(
  bossSearchTask,
  liveRuntimeForSubmit,
  [restrictedChromeBossIdentity],
);
if (
  !bossReadiness.ok ||
  bossReadiness.identity.admissionFacts?.warningReasonCodes.includes("proxy_missing") !== true ||
  bossReadiness.payload.public_query?.query !== "前端工程师" ||
  bossReadiness.payload.public_query?.city_code !== "101020100" ||
  bossReadiness.payload.public_query?.page !== 1 ||
  bossReadiness.payload.public_query?.limit !== 15 ||
  Object.keys(bossReadiness.payload.public_query ?? {}).length !== 4 ||
  bossReadiness.payload.task_intent.scope.target_type !== "boss_job_search" ||
  bossReadiness.payload.harbor.url !== "https://www.zhipin.com/web/geek/job?query=%E5%89%8D%E7%AB%AF%E5%B7%A5%E7%A8%8B%E5%B8%88&city=101020100" ||
  bossReadiness.payload.task_intent.capability.ref !== "lode:capability/job-search" ||
  bossReadiness.payload.task_intent.resource_requirement_profile_id !== "job-search-logged-in-ready-page" ||
  JSON.stringify(bossReadiness.payload).includes("detail_ref") ||
  JSON.stringify(bossReadiness.payload).includes("read-job-detail")
) {
  throw new Error(`Core BOSS submit smoke failed: canonical one-shot search payload is malformed: ${JSON.stringify(bossReadiness)}`);
}
if (!coreTaskSubmitClientModule.isReadOnlyIdentityAdmitted(restrictedChromeBossIdentity, "boss", coreReadTaskClientModule.coreReadTaskSpecs[1])) {
  throw new Error("Core BOSS submit smoke failed: identity task entry disagrees with the accepted restricted Chrome search admission.");
}
if (coreTaskSubmitClientModule.readOnlyIdentityAdmissionBlockReason(restrictedChromeBossIdentity, "task-boss-real-read") !== null) {
  throw new Error("Core BOSS submit smoke failed: identity task entry blocked the accepted restricted Chrome search admission.");
}
for (const taskId of ["task-boss-greeting-write-preview", "task-unknown"]) {
  if (coreTaskSubmitClientModule.readOnlyIdentityAdmissionBlockReason(readyBossIdentity, taskId) === null) {
    throw new Error(`Core BOSS submit smoke failed: identity task entry admitted non-read task ${taskId}.`);
  }
}
if (coreTaskSubmitClientModule.isReadOnlyIdentityAdmitted(readyBossIdentity, "boss", coreReadTaskClientModule.coreReadTaskSpecs[3])) {
  throw new Error("Core BOSS submit smoke failed: exported read-only identity admission accepted a write-precheck spec.");
}
if (coreTaskSubmitClientModule.readOnlyIdentityAdmissionBlockReason({ ...readyBossIdentity, source: "App local-only" }, "task-boss-real-read") === null) {
  throw new Error("Core BOSS submit smoke failed: identity task entry admitted a non-live identity.");
}
if (coreTaskSubmitClientModule.readOnlyIdentityAdmissionBlockReason({ ...readyBossIdentity, login: { ...readyBossIdentity.login, recoveryRequired: true } }, "task-boss-real-read") === null) {
  throw new Error("Core BOSS submit smoke failed: identity task entry admitted an identity that requires authentication recovery.");
}
for (const [label, warningReasonCodes] of [
  ["proxy-only", ["proxy_missing"]],
  ["unknown warning", ["provider_conflict", "proxy_missing", "fingerprint_conflict", "other"]],
]) {
  const identity = {
    ...restrictedChromeBossIdentity,
    admissionFacts: { ...restrictedChromeBossIdentity.admissionFacts, warningReasonCodes },
  };
  const accepted = coreTaskSubmitClientModule.coreTaskSubmitReadiness(bossSearchTask, liveRuntimeForSubmit, [identity]).ok;
  if (label === "proxy-only" ? !accepted : accepted) {
    throw new Error(`Core BOSS submit smoke failed: restricted Chrome ${label} case had the wrong admission result.`);
  }
}
const xhsMissingProxyIdentity = {
  ...restrictedChromeIdentity,
  admissionFacts: {
    ...restrictedChromeIdentity.admissionFacts,
    warningReasonCodes: ["proxy_missing"],
  },
};
if (coreTaskSubmitClientModule.coreTaskSubmitReadiness(readonlySubmitTask, liveRuntimeForSubmit, [xhsMissingProxyIdentity]).ok) {
  throw new Error("Core submit smoke failed: Xiaohongshu restricted Chrome with proxy_missing was accepted.");
}
if (coreTaskSubmitClientModule.isReadOnlyIdentityAdmitted(xhsMissingProxyIdentity, "xiaohongshu", coreReadTaskClientModule.coreReadTaskSpecs[0])) {
  throw new Error("Core submit smoke failed: identity task entry admitted Xiaohongshu restricted Chrome with proxy_missing.");
}
for (const [length, accepted] of [[80, true], [81, false]]) {
  const businessInput = JSON.stringify({ query: "x".repeat(length), city_code: "101020100", page: 1, limit: 15 });
  const readiness = coreTaskSubmitClientModule.coreTaskSubmitReadiness({
    ...bossSearchTask,
    threadContext: { ...bossSearchTask.threadContext, accountIdentityKey: readyBossIdentity.identityEnvironmentRef },
    businessInput,
  }, liveRuntimeForSubmit, [readyBossIdentity]);
  if (readiness.ok !== accepted) {
    throw new Error(`Core BOSS submit smoke failed: ${length}-character query acceptance was ${readiness.ok}.`);
  }
}

const invalidBossInputs = [
  ["free-text city", "职位：前端工程师；城市：上海"],
  ["missing city_code", JSON.stringify({ query: "前端工程师", page: 1, limit: 15 })],
  ["unknown city_code", JSON.stringify({ query: "前端工程师", city_code: "999999999", page: 1, limit: 15 })],
  ["unknown filter", JSON.stringify({ query: "前端工程师", city_code: "101020100", salary: "20-30K", page: 1, limit: 15 })],
  ["pagination", JSON.stringify({ query: "前端工程师", city_code: "101020100", page: 2, limit: 15 })],
  ["bulk limit", JSON.stringify({ query: "前端工程师", city_code: "101020100", page: 1, limit: 16 })],
];
for (const [label, businessInput] of invalidBossInputs) {
  if (coreTaskSubmitClientModule.coreTaskSubmitReadiness({
    ...bossSearchTask,
    threadContext: { ...bossSearchTask.threadContext, accountIdentityKey: readyBossIdentity.identityEnvironmentRef },
    businessInput,
  }, liveRuntimeForSubmit, [readyBossIdentity]).ok) {
    throw new Error(`Core BOSS submit smoke failed: ${label} was accepted.`);
  }
}
for (const identity of [
  { ...readyBossIdentity, source: "Harbor fixture" },
  { ...readyBossIdentity, source: "App local-only" },
  { ...readyBossIdentity, login: { recoveryRequired: true }, readiness: { state: "needs-auth" } },
]) {
  if (coreTaskSubmitClientModule.coreTaskSubmitReadiness({
    ...bossSearchTask,
    threadContext: { ...bossSearchTask.threadContext, accountIdentityKey: identity.identityEnvironmentRef },
  }, liveRuntimeForSubmit, [identity]).ok) {
    throw new Error("Core BOSS submit smoke failed: fixture or unlogged identity was accepted.");
  }
}
if (coreTaskSubmitClientModule.coreTaskSubmitReadiness(bossSearchTask, { ...liveRuntimeForSubmit, canUseLiveRuntime: false }, [restrictedChromeBossIdentity]).ok) {
  throw new Error("Core BOSS submit smoke failed: offline runtime was accepted.");
}
for (const id of ["task-boss-greeting-write-preview", "task-boss-job-search-bulk"]) {
  if (coreTaskSubmitClientModule.coreTaskSubmitReadiness({ ...bossSearchTask, id }, liveRuntimeForSubmit, [restrictedChromeBossIdentity]).ok) {
    throw new Error(`Core BOSS submit smoke failed: write/precheck/bulk task was admitted: ${id}`);
  }
}

const promotedTask = coreTaskSubmitClientModule.promoteSubmittedCoreTask(
  { ...readonlySubmitTask, source: "Core fixture", identitySource: "Harbor fixture", runs: [{ id: "fixture-run", source: "Core fixture" }] },
  { id: "live-run", source: "Core live" },
);
if (
  promotedTask.source !== "Core live" ||
  promotedTask.identitySource !== "Harbor live" ||
  promotedTask.runs.length !== 1 ||
  promotedTask.runs[0]?.id !== "live-run" ||
  promotedTask.packageSource.lockRef !== readonlySubmitTask.packageSource.lockRef
) {
  throw new Error(`Core submit smoke failed: live promotion retained fixture history or rewrote Lode provenance: ${JSON.stringify(promotedTask)}`);
}

const restrictedChromeNegativeMatrix = [
  ["site", { siteId: "boss" }],
  ["provider", { admissionFacts: { ...restrictedChromeIdentity.admissionFacts, providerId: "cloakbrowser" } }],
  ["role", { admissionFacts: { ...restrictedChromeIdentity.admissionFacts, providerRole: "primary" } }],
  ["provenance", { admissionFacts: { ...restrictedChromeIdentity.admissionFacts, authenticationProvenance: "unknown" } }],
  ["login", { admissionFacts: { ...restrictedChromeIdentity.admissionFacts, loginState: "unknown" } }],
  ["manual auth", { admissionFacts: { ...restrictedChromeIdentity.admissionFacts, manualAuthenticationState: "required" } }],
  ["recovery", { admissionFacts: { ...restrictedChromeIdentity.admissionFacts, recoveryRequired: true } }],
  ["storage", { admissionFacts: { ...restrictedChromeIdentity.admissionFacts, browserStorageState: "unknown" } }],
  ["unexpected warning", { admissionFacts: { ...restrictedChromeIdentity.admissionFacts, warningReasonCodes: ["provider_conflict", "other"] } }],
  ["generally ready", { provider: { ...restrictedChromeIdentity.provider, state: "ready" } }],
];
for (const [label, change] of restrictedChromeNegativeMatrix) {
  const candidate = { ...restrictedChromeIdentity, ...change };
  if (coreTaskSubmitClientModule.coreTaskSubmitReadiness(readonlySubmitTask, liveRuntimeForSubmit, [candidate]).ok) {
    throw new Error(`Core submit smoke failed: restricted Chrome ${label} negative case was accepted.`);
  }
}

for (const [label, searchQuery] of [["missing", undefined], ["empty", ""], ["untrimmed", " AI 工具"], ["too long", "x".repeat(257)], ["ambiguous", ["AI 工具", "咖啡"]]]) {
  if (coreTaskSubmitClientModule.coreTaskSubmitReadiness({ ...readonlySubmitTask, searchQuery }, liveRuntimeForSubmit, [restrictedChromeIdentity]).ok) {
    throw new Error(`Core submit smoke failed: ${label} public query was accepted.`);
  }
}

for (const task of [
  { ...readonlySubmitTask, id: "task-xhs-write-preview" },
  { ...readonlySubmitTask, id: "task-xhs-bulk-search" },
]) {
  if (task && coreTaskSubmitClientModule.coreTaskSubmitReadiness(task, liveRuntimeForSubmit, [restrictedChromeIdentity]).ok) {
    throw new Error(`Core submit smoke failed: unsupported BOSS/write/bulk task was admitted: ${task.id}`);
  }
}

const crossOriginReadiness = coreTaskSubmitClientModule.coreTaskSubmitReadiness(
  {
    ...readonlySubmitTask,
    businessInput: "读取 https://example.test/not-the-selected-site",
  },
  liveRuntimeForSubmit,
  [readyXhsIdentity],
);

if (crossOriginReadiness.ok) {
  throw new Error("Core submit smoke failed: cross-origin task URL was accepted.");
}

const originalFetch = globalThis.fetch;
const fakeRun = {
  schema_version: "webenvoy.run-query.v0",
  run_id: "run_owner_real_site_xhs_001",
  status: "succeeded",
  timeline: {
    created_at: "2026-07-06T10:00:00.000Z",
    updated_at: "2026-07-06T10:00:03.000Z",
    terminal_at: "2026-07-06T10:00:03.000Z",
  },
  task: {
    capability_ref: "lode:capability/search-notes",
    capability_version: "0.1.0",
    capability_source_ref: "lode://site-capability/xiaohongshu/search-notes@0.1.0",
    capability_lock_ref: "lode://lock/site-capability/xiaohongshu/search-notes@0.1.0",
    package_ref: "lode://site-capability/xiaohongshu/search-notes@0.1.0",
  },
  admission: {
    decision: "accepted",
    action_risk: "read",
  },
  runtime_refs: {
    session_binding: {
      runtime_session_ref: "session_f76393db-e74f-4bec-88be-63754f7a5d00",
      control_owner: "core_task",
      lifecycle_state: "active",
      session_use: "core_task_run",
    },
  },
  terminal_summary: {
    terminal: true,
    status: "succeeded",
    result_ref: "result:core/xiaohongshu/search-notes/contract",
    post_check: {
      schema_version: "webenvoy.post-check-result.v0",
      status: "passed",
      summary: "Owner contract result refs are queryable.",
    },
  },
};

const submitFetchCalls = [];
let submittedTaskPayload;
const ownerRequestTimeouts = [];
const coreJsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});
const originalWindowSetTimeout = globalThis.window.setTimeout;
globalThis.window.setTimeout = (callback, timeout) => {
  ownerRequestTimeouts.push(timeout);
  return originalWindowSetTimeout(callback, timeout);
};
globalThis.fetch = async (url, init = {}) => {
  const pathname = String(url);
  submitFetchCalls.push(`${init.method ?? "GET"} ${pathname}`);
  if (pathname.endsWith("/tasks")) submittedTaskPayload = JSON.parse(init.body);
  const submitRun = { ...fakeRun, run_id: "run_submit_xhs_001" };
  const json = pathname.endsWith("/tasks")
    ? { ok: true, run_id: submitRun.run_id }
    : pathname.endsWith(`/runs/${submitRun.run_id}`)
    ? { ok: true, run: submitRun }
    : pathname.endsWith("/result")
    ? {
        ok: true,
        result: {
          schema_version: "webenvoy.result-query.v0",
          run_id: submitRun.run_id,
          status: "succeeded",
          terminal: true,
          result: {
            envelope_state: "available",
            payload_state: "not_persisted_in_core",
            result_envelope: {
              result_kind: "xhs_note_search",
              result_ref: "result:core/xiaohongshu/search-notes/submitted",
              package_ref: "lode://site-capability/xiaohongshu/search-notes@0.1.0",
              evidence_refs: ["harbor:evidence/xiaohongshu/search-notes/submitted"],
            },
          },
        },
      }
    : pathname.endsWith("/evidence-refs")
    ? {
        ok: true,
        evidence: {
          evidence_refs: [
            {
              ref: "harbor:evidence/xiaohongshu/search-notes/submitted",
              source: "submit_contract",
              state: "available",
              raw_access: "not_available_from_core",
              recorded_at: "2026-07-06T10:01:03.000Z",
              runtime_session_ref: harborRuntimeSession.runtime_session_ref,
            },
          ],
        },
      }
    : pathname.endsWith("/failure")
    ? { ok: true, failure_reason: { reason_class: "none", app_action: "none", retryable: false } }
    : pathname.endsWith("/session-refs")
    ? {
        ok: true,
        session_refs: {
          session_refs: {
            runtime_session_ref: harborRuntimeSession.runtime_session_ref,
            control_owner: "core_task",
            lifecycle_state: "active",
            session_use: "core_task_run",
          },
        },
      }
    : { ok: false, error: { code: "unexpected_submit_contract_path" } };
  return coreJsonResponse(json);
};
const submittedRun = await coreTaskSubmitClientModule.submitCoreReadOnlyTask(
  "http://core.test",
  readonlySubmitTask,
  liveRuntimeForSubmit,
  [readyXhsIdentity],
  { pollAttempts: 1, pollIntervalMs: 0 },
);
globalThis.fetch = originalFetch;
globalThis.window.setTimeout = originalWindowSetTimeout;

if (submittedRun.status !== "ready" || submittedRun.runId !== "run_submit_xhs_001") {
  throw new Error(`Core submit smoke failed: submit/poll did not return ready run: ${JSON.stringify(submittedRun)}`);
}
if (
  submitFetchCalls.filter((entry) => entry.startsWith("POST ") && entry.endsWith("/tasks")).length !== 1 ||
  submittedTaskPayload?.public_query?.query !== "AI 工具" ||
  JSON.stringify(submittedTaskPayload).includes(readonlySubmitTask.businessInput)
) {
  throw new Error(`Core submit smoke failed: one-shot POST or exact public query contract was violated: ${JSON.stringify(submittedTaskPayload)}`);
}
if (ownerRequestTimeouts[0] !== 65_000 || ownerRequestTimeouts.slice(1).some((timeout) => timeout !== 2500)) {
  throw new Error(`Core submit smoke failed: /tasks and owner read timeouts diverged from IPC boundaries: ${ownerRequestTimeouts.join(",")}`);
}

for (const expectedPath of ["/tasks", "/runs/run_submit_xhs_001", "/result", "/evidence-refs", "/failure", "/session-refs"]) {
  if (!submitFetchCalls.some((entry) => entry.includes(expectedPath))) {
    throw new Error(`Core submit smoke failed: ${expectedPath} was not consumed.`);
  }
}

if (!submittedRun.run.evidenceCards[0]?.summary.includes("harbor:evidence/xiaohongshu/search-notes/submitted")) {
  throw new Error("Core submit smoke failed: submitted run evidence refs were not projected.");
}

if (!submittedRun.run.resultRows.some((row) => row.value === harborRuntimeSession.runtime_session_ref)) {
  throw new Error("Core submit smoke failed: Harbor session ref from create/readback/session chain was not projected.");
}

globalThis.fetch = async (url, init = {}) => {
  const pathname = String(url);
  const json = pathname.endsWith("/tasks")
    ? { ok: true, run_id: "run_submit_pending_001" }
    : pathname.includes("/runs/run_submit_pending_001")
    ? { ok: false, error: { code: "run_not_queryable_yet" } }
    : { ok: false, error: { code: "unexpected_pending_smoke_path" } };
  return coreJsonResponse(json);
};
const pendingRun = await coreTaskSubmitClientModule.submitCoreReadOnlyTask(
  "http://core.test",
  readonlySubmitTask,
  liveRuntimeForSubmit,
  [readyXhsIdentity],
  { pollAttempts: 2, pollIntervalMs: 0 },
);
globalThis.fetch = originalFetch;

if (pendingRun.status !== "polling" || pendingRun.runId !== "run_submit_pending_001") {
  throw new Error(`Core submit smoke failed: accepted-but-not-ready run was not kept in polling state: ${JSON.stringify(pendingRun)}`);
}

let submittedBossPayload;
const acceptsCore273BossPayload = (payload) =>
  payload?.task_intent?.capability?.ref === "lode:capability/job-search" &&
  payload?.task_intent?.capability?.source_ref === "lode://site-capability/boss/job-search@0.1.0" &&
  payload?.task_intent?.resource_requirement_profile_id === "job-search-logged-in-ready-page" &&
  payload?.task_intent?.scope?.target_type === "boss_job_search" &&
  payload?.task_intent?.scope?.target_ref === "https://www.zhipin.com/web/geek/job?query=%E5%89%8D%E7%AB%AF%E5%B7%A5%E7%A8%8B%E5%B8%88&city=101020100" &&
  payload?.public_query?.query === "前端工程师" &&
  payload?.public_query?.city_code === "101020100" &&
  payload?.public_query?.page === 1 &&
  payload?.public_query?.limit === 15 &&
  Object.keys(payload.public_query).length === 4 &&
  payload?.harbor?.url === "https://www.zhipin.com/web/geek/job?query=%E5%89%8D%E7%AB%AF%E5%B7%A5%E7%A8%8B%E5%B8%88&city=101020100";
globalThis.fetch = async (url, init = {}) => {
  const pathname = String(url);
  if (pathname.endsWith("/tasks")) {
    submittedBossPayload = JSON.parse(init.body);
    const accepted = acceptsCore273BossPayload(submittedBossPayload);
    const body = accepted
      ? { ok: true, run_id: "run_submit_boss_001" }
      : { ok: false, error: { code: "public_query_invalid" } };
    return coreJsonResponse(body, accepted ? 202 : 400);
  }
  const body = { ok: false, error: { code: "run_not_queryable_yet" } };
  return coreJsonResponse(body);
};
const acceptedBossRun = await coreTaskSubmitClientModule.submitCoreReadOnlyTask(
  "http://core.test",
  bossSearchTask,
  liveRuntimeForSubmit,
  [restrictedChromeBossIdentity],
  { pollAttempts: 1, pollIntervalMs: 0 },
);
const acceptedBossPayload = submittedBossPayload;
const wrongTargetTypeResponse = await globalThis.fetch("http://core.test/tasks", {
  method: "POST",
  body: JSON.stringify({
    ...acceptedBossPayload,
    task_intent: {
      ...acceptedBossPayload.task_intent,
      scope: { ...acceptedBossPayload.task_intent.scope, target_type: "site" },
    },
  }),
});
globalThis.fetch = originalFetch;
if (
  acceptedBossRun.status !== "polling" ||
  acceptedBossRun.runId !== "run_submit_boss_001" ||
  acceptedBossPayload?.public_query?.query !== "前端工程师" ||
  acceptedBossPayload?.public_query?.city_code !== "101020100" ||
  acceptedBossPayload?.public_query?.page !== 1 ||
  acceptedBossPayload?.public_query?.limit !== 15 ||
  Object.keys(acceptedBossPayload?.public_query ?? {}).length !== 4 ||
  acceptedBossPayload?.task_intent?.scope?.target_type !== "boss_job_search" ||
  acceptedBossPayload?.harbor?.timeout_ms !== 60_000 ||
  acceptedBossPayload?.harbor?.url !== "https://www.zhipin.com/web/geek/job?query=%E5%89%8D%E7%AB%AF%E5%B7%A5%E7%A8%8B%E5%B8%88&city=101020100"
) {
  throw new Error(`Core BOSS submit smoke failed: mock POST /tasks did not accept the Core #273 payload: ${JSON.stringify({ acceptedBossRun, acceptedBossPayload })}`);
}
if (wrongTargetTypeResponse.status !== 400) {
  throw new Error("Core BOSS submit smoke failed: wrong target_type was not rejected by the Core #273 contract handler.");
}

globalThis.fetch = async (url) => {
  const pathname = String(url);
  const json = pathname.includes("/capability-runs") && pathname.includes("search-notes")
    ? { ok: true, capability_runs: { runs: [fakeRun], latest_run: fakeRun } }
    : pathname.includes("/capability-runs")
    ? { ok: true, capability_runs: { runs: [] } }
    : pathname.endsWith("/result")
    ? {
        ok: true,
        result: {
          schema_version: "webenvoy.result-query.v0",
          run_id: fakeRun.run_id,
          status: "succeeded",
          terminal: true,
          result: {
            envelope_state: "available",
            payload_state: "not_persisted_in_core",
            result_ref: "result:core/xiaohongshu/search-notes/contract",
            result_envelope: {
              result_kind: "xhs_note_search",
              result_ref: "result:core/xiaohongshu/search-notes/contract",
              package_ref: "lode://site-capability/xiaohongshu/search-notes@0.1.0",
              source_refs: ["source_6f45e8c0"],
              evidence_refs: [
                "screenshot_f65fac74-c1e8-4285-8015-ac8e22eb7d76",
                "post_check_1c29bb68-10e4-458f-b384-97f249e711e9",
              ],
              post_check: {
                ref: "post_check_1c29bb68-10e4-458f-b384-97f249e711e9",
                status: "passed",
              },
            },
          },
          evidence_refs: [
            {
              ref: "screenshot_f65fac74-c1e8-4285-8015-ac8e22eb7d76",
              source: "admission_and_terminal",
              state: "available",
              raw_access: "not_available_from_core",
              recorded_at: "2026-07-06T10:00:03.000Z",
              runtime_session_ref: "session_f76393db-e74f-4bec-88be-63754f7a5d00",
            },
            {
              ref: "post_check_1c29bb68-10e4-458f-b384-97f249e711e9",
              source: "terminal_post_check",
              state: "available",
              raw_access: "not_available_from_core",
              recorded_at: "2026-07-06T10:00:03.000Z",
              runtime_session_ref: "session_f76393db-e74f-4bec-88be-63754f7a5d00",
            },
          ],
        },
      }
    : pathname.endsWith("/evidence-refs")
    ? {
        ok: true,
        evidence: {
          evidence_refs: [],
        },
      }
    : pathname.endsWith("/failure")
    ? { ok: true, failure_reason: { reason_class: "none", app_action: "none", retryable: false } }
    : { ok: true, session_refs: { session_refs: { runtime_session_ref: "session_f76393db-e74f-4bec-88be-63754f7a5d00" } } };
  return coreJsonResponse(json);
};
const coreReadState = await coreReadTaskClientModule.fetchCoreReadTaskState("http://core.test", [
  {
    id: "task-xhs-real-read",
    title: "小红书搜索与笔记读取",
    accountIdentity: "小红书运营号 A",
    siteSkill: "小红书搜索和笔记读取",
    businessInput: "关键词：AI 工具",
    source: "Core fixture",
    packageSource: {
      name: "@lode/xiaohongshu-read-only",
      version: "0.1.0",
      capabilityRef: "lode:capability/search-notes",
      sourceRef: "lode://site-capability/xiaohongshu/search-notes@0.1.0",
      fetchedAt: "fixture",
      source: "Lode fixture",
      boundary: "fixture",
    },
    runs: [],
  },
]);
globalThis.fetch = originalFetch;

if (coreReadState.status !== "ready" || coreReadState.tasks[0].runs[0]?.source !== "Core live") {
  throw new Error("Core read task smoke failed: live Core projection was not applied.");
}

if (!coreReadState.tasks[0].runs[0].evidenceCards[0]?.summary.includes("not_available_from_core")) {
  throw new Error("Core read task smoke failed: raw evidence boundary is missing.");
}

if (coreReadState.tasks[0].runs[0].failureRecovery) {
  throw new Error("Core read task smoke failed: reason_class none rendered as recoverable failure.");
}

if (coreReadState.tasks[0].runs[0].actionIntent.includes("none")) {
  throw new Error("Core read task smoke failed: app_action none rendered as an action intent.");
}

globalThis.fetch = async (url) => {
  const pathname = String(url);
  const fixtureRun = { ...fakeRun, run_id: "run_fixture_rejected_001" };
  const json = pathname.includes("/capability-runs") && pathname.includes("search-notes")
    ? { ok: true, capability_runs: { runs: [fixtureRun], latest_run: fixtureRun } }
    : pathname.includes("/capability-runs")
      ? { ok: true, capability_runs: { runs: [] } }
      : { ok: false, error: { code: "fixture_payload_should_not_be_queried" } };
  return coreJsonResponse(json);
};
const fixtureCoreReadState = await coreReadTaskClientModule.fetchCoreReadTaskState("http://core.test", [
  {
    id: "task-xhs-real-read",
    title: "小红书搜索与笔记读取",
    accountIdentity: "小红书运营号 A",
    siteSkill: "小红书搜索和笔记读取",
    businessInput: "关键词：AI 工具",
    source: "Core fixture",
    packageSource: {
      name: "@lode/xiaohongshu-read-only",
      version: "0.1.0",
      capabilityRef: "lode:capability/search-notes",
      sourceRef: "lode://site-capability/xiaohongshu/search-notes@0.1.0",
      fetchedAt: "fixture",
      source: "Lode fixture",
      boundary: "fixture",
    },
    runs: [],
  },
]);
globalThis.fetch = originalFetch;

if (fixtureCoreReadState.status !== "offline" || fixtureCoreReadState.liveTaskIds.length !== 0) {
  throw new Error("Core read task smoke failed: fixture-shaped Core payload was accepted as live.");
}

const bossFakeRun = {
  schema_version: "webenvoy.run-query.v0",
  run_id: "run_owner_real_site_boss_001",
  status: "manual_recovery_required",
  timeline: {
    created_at: "2026-07-06T10:20:00.000Z",
    updated_at: "2026-07-06T10:20:03.000Z",
    terminal_at: "2026-07-06T10:20:03.000Z",
  },
  task: {
    capability_ref: "lode:capability/job-search",
    capability_version: "0.1.0",
    capability_source_ref: "lode://site-capability/boss/job-search@0.1.0",
    capability_lock_ref: "lode://lock/site-capability/boss/job-search@0.1.0",
    package_ref: "lode://site-capability/boss/job-search@0.1.0",
  },
  admission: {
    decision: "accepted",
    action_risk: "read",
  },
  runtime_refs: {
    session_binding: {
      runtime_session_ref: "harbor:runtime-session/boss/readonly",
      control_owner: "core_task",
      lifecycle_state: "active",
      session_use: "core_task_run",
    },
  },
  terminal_summary: {
    terminal: true,
    status: "manual_recovery_required",
    result_ref: "result:core/boss/job-search/contract",
    post_check: {
      schema_version: "webenvoy.post-check-result.v0",
      status: "failed",
      summary: "Login recovery required before reading BOSS job cards.",
    },
    failure: {
      code: "login_required",
      category: "identity",
      phase: "admission",
      recovery_hint: "open_identity_session",
    },
  },
};
const bossFetchCalls = new Set();
globalThis.fetch = async (url) => {
  const pathname = String(url);
  const json = pathname.includes("/capability-runs")
    ? (bossFetchCalls.add("capability-runs"),
      pathname.includes("job-search")
        ? { ok: true, capability_runs: { runs: [bossFakeRun], latest_run: bossFakeRun } }
        : { ok: true, capability_runs: { runs: [] } })
    : pathname.endsWith("/result")
    ? (bossFetchCalls.add("result"),
      {
        ok: true,
        result: {
          schema_version: "webenvoy.result-query.v0",
          run_id: bossFakeRun.run_id,
          status: "manual_recovery_required",
          terminal: true,
          result: {
            envelope_state: "available",
            payload_state: "not_persisted_in_core",
            result_ref: "result:core/boss/job-search/contract",
            result_envelope: {
              result_kind: "boss_job_search",
              result_ref: "result:core/boss/job-search/contract",
              package_ref: "lode://site-capability/boss/job-search@0.1.0",
              evidence_refs: ["harbor:evidence/boss/job-search/login-required"],
            },
          },
        },
      })
    : pathname.endsWith("/evidence-refs")
    ? (bossFetchCalls.add("evidence"),
      {
        ok: true,
        evidence: {
          evidence_refs: [
            {
              ref: "harbor:evidence/boss/job-search/login-required",
              source: "core_failure",
              state: "available",
              raw_access: "not_available_from_core",
              recorded_at: "2026-07-06T10:20:03.000Z",
              runtime_session_ref: "harbor:runtime-session/boss/readonly",
            },
          ],
        },
      })
    : pathname.endsWith("/failure")
    ? (bossFetchCalls.add("failure"),
      {
        ok: true,
        failure_reason: {
          reason_class: "login_required",
          app_action: "open_identity_session",
          retryable: true,
          failure: {
            code: "login_required",
            category: "identity",
            phase: "admission",
            recovery_hint: "open_identity_session",
          },
        },
      })
    : pathname.endsWith("/session-refs")
    ? (bossFetchCalls.add("session"),
      {
        ok: true,
        session_refs: {
          session_refs: {
            runtime_session_ref: "harbor:runtime-session/boss/readonly",
            control_owner: "core_task",
            lifecycle_state: "active",
            session_use: "core_task_run",
          },
        },
      })
    : { ok: true };
  return coreJsonResponse(json);
};
const bossCoreReadState = await coreReadTaskClientModule.fetchCoreReadTaskState("http://core.test", [
  {
    id: "task-boss-real-read",
    title: "BOSS 搜索与职位详情读取",
    accountIdentity: "BOSS 招聘号",
    siteSkill: "BOSS 搜索和职位详情读取",
    businessInput: "职位：前端工程师；城市：上海",
    source: "Core fixture",
    packageSource: {
      name: "@lode/boss-read-only",
      version: "0.1.0",
      capabilityRef: "lode:capability/job-search + lode:capability/read-job-detail",
      sourceRef: "lode://site-capability/boss/job-search@0.1.0 + lode://site-capability/boss/read-job-detail@0.1.0",
      fetchedAt: "fixture",
      source: "Lode fixture",
      boundary: "fixture",
    },
    runs: [],
  },
]);
globalThis.fetch = originalFetch;

const bossLiveRun = bossCoreReadState.tasks.find((task) => task.id === "task-boss-real-read")?.runs[0];

for (const expectedCall of ["capability-runs", "result", "evidence", "session"]) {
  if (!bossFetchCalls.has(expectedCall)) {
    throw new Error(`Core read task smoke failed: BOSS ${expectedCall} mock was not consumed.`);
  }
}

if (bossCoreReadState.status !== "ready" || bossLiveRun?.source !== "Core live") {
  throw new Error("Core read task smoke failed: BOSS live Core projection was not applied.");
}

if (bossLiveRun.capabilityAttribution?.failureClass !== "login_required") {
  throw new Error("Core read task smoke failed: BOSS failure class was swallowed.");
}

if (bossLiveRun.failureRecovery?.state !== "未登录" || !bossLiveRun.failureRecovery.nextActions[0]?.includes("open_identity_session")) {
  throw new Error("Core read task smoke failed: BOSS failure recovery action was swallowed.");
}

if (!bossLiveRun.actionIntent.includes("open_identity_session")) {
  throw new Error("Core read task smoke failed: BOSS action label was swallowed.");
}

globalThis.fetch = async (url) => {
  const pathname = String(url);
  const json = pathname.includes("/capability-runs")
    ? { ok: true, capability_runs: { runs: [fakeRun] } }
    : pathname.endsWith("/result")
    ? { ok: false, error: { code: "result_query_unavailable" } }
    : { ok: true, evidence: { evidence_refs: [] } };
  return coreJsonResponse(json);
};
const failedDetailState = await coreReadTaskClientModule.fetchCoreReadTaskState("http://core.test", [
  {
    id: "task-xhs-real-read",
    title: "小红书搜索与笔记读取",
    accountIdentity: "小红书运营号 A",
    siteSkill: "小红书搜索和笔记读取",
    businessInput: "关键词：AI 工具",
    source: "Core fixture",
    packageSource: {
      name: "@lode/xiaohongshu-read-only",
      version: "0.1.0",
      capabilityRef: "lode:capability/search-notes",
      sourceRef: "lode://site-capability/xiaohongshu/search-notes@0.1.0",
      fetchedAt: "fixture",
      source: "Lode fixture",
      boundary: "fixture",
    },
    runs: [],
  },
]);
globalThis.fetch = originalFetch;

if (failedDetailState.status !== "offline" || failedDetailState.liveTaskIds.length !== 0) {
  throw new Error("Core read task smoke failed: per-run detail failure was treated as live projection.");
}

const olderRun = {
  ...fakeRun,
  run_id: "run_older_ok",
  timeline: {
    created_at: "2026-07-06T09:50:00.000Z",
    updated_at: "2026-07-06T09:50:03.000Z",
    terminal_at: "2026-07-06T09:50:03.000Z",
  },
};
const latestRunWithFailedDetail = {
  ...fakeRun,
  run_id: "run_latest_failed",
  timeline: {
    created_at: "2026-07-06T10:10:00.000Z",
    updated_at: "2026-07-06T10:10:03.000Z",
    terminal_at: "2026-07-06T10:10:03.000Z",
  },
};
globalThis.fetch = async (url) => {
  const pathname = String(url);
  const json = pathname.includes("/capability-runs") && pathname.includes("search-notes")
    ? { ok: true, capability_runs: { runs: [latestRunWithFailedDetail, olderRun] } }
    : pathname.includes("/capability-runs")
    ? { ok: true, capability_runs: { runs: [] } }
    : pathname.includes("/runs/run_latest_failed/result")
    ? { ok: false, error: { code: "latest_result_unavailable" } }
    : pathname.endsWith("/result")
    ? {
        ok: true,
        result: {
          schema_version: "webenvoy.result-query.v0",
          run_id: olderRun.run_id,
          status: "succeeded",
          terminal: true,
          result: {
            envelope_state: "available",
            payload_state: "not_persisted_in_core",
            result_envelope: {
              result_kind: "xhs_note_search",
              evidence_refs: ["harbor:evidence/xiaohongshu/search-notes/older"],
            },
          },
        },
      }
    : pathname.endsWith("/evidence-refs")
    ? { ok: true, evidence: { evidence_refs: [] } }
    : pathname.endsWith("/failure")
    ? { ok: true, failure_reason: { reason_class: "none", app_action: "none", retryable: false } }
    : { ok: true, session_refs: { session_refs: { runtime_session_ref: harborRuntimeSession.runtime_session_ref } } };
  return coreJsonResponse(json);
};
const mixedDetailState = await coreReadTaskClientModule.fetchCoreReadTaskState("http://core.test", [
  {
    id: "task-xhs-real-read",
    title: "小红书搜索与笔记读取",
    accountIdentity: "小红书运营号 A",
    siteSkill: "小红书搜索和笔记读取",
    businessInput: "关键词：AI 工具",
    source: "Core fixture",
    packageSource: {
      name: "@lode/xiaohongshu-read-only",
      version: "0.1.0",
      capabilityRef: "lode:capability/search-notes",
      sourceRef: "lode://site-capability/xiaohongshu/search-notes@0.1.0",
      fetchedAt: "fixture",
      source: "Lode fixture",
      boundary: "fixture",
    },
    runs: [],
  },
]);
globalThis.fetch = originalFetch;

if (mixedDetailState.status !== "offline" || mixedDetailState.liveTaskIds.length !== 0) {
  throw new Error("Core read task smoke failed: mixed run detail failure was hidden by an older run.");
}

const writePreviewRuns = [
  {
    schema_version: "webenvoy.run-query.v0",
    run_id: "run_owner_real_site_xiaohongshu_write_preview_001",
    status: "succeeded",
    timeline: { updated_at: "2026-07-06T11:00:04.000Z", terminal_at: "2026-07-06T11:00:04.000Z" },
    task: {
      capability_ref: "lode:capability/xiaohongshu-draft-precheck",
      capability_version: "0.1.0",
      capability_source_ref: "lode://site-capability/xiaohongshu/draft-precheck@0.1.0",
      package_ref: "lode://site-capability/xiaohongshu/draft-precheck@0.1.0",
    },
    admission: { action_risk: "write" },
    runtime_refs: {
      session_binding: { runtime_session_ref: "harbor:runtime-session/xiaohongshu/write-precheck" },
    },
  },
  {
    schema_version: "webenvoy.run-query.v0",
    run_id: "run_owner_real_site_write_preview_cancelled_001",
    status: "cancelled",
    timeline: { updated_at: "2026-07-06T11:03:02.000Z", terminal_at: "2026-07-06T11:03:02.000Z" },
    task: {
      capability_ref: "lode:capability/xiaohongshu-draft-precheck",
      capability_version: "0.1.0",
      capability_source_ref: "lode://site-capability/xiaohongshu/draft-precheck@0.1.0",
      package_ref: "lode://site-capability/xiaohongshu/draft-precheck@0.1.0",
    },
    admission: { action_risk: "write" },
  },
  {
    schema_version: "webenvoy.run-query.v0",
    run_id: "run_owner_real_site_write_preview_expired_001",
    status: "expired",
    timeline: { updated_at: "2026-07-06T11:14:01.000Z", terminal_at: "2026-07-06T11:14:01.000Z" },
    task: {
      capability_ref: "lode:capability/xiaohongshu-draft-precheck",
      capability_version: "0.1.0",
      capability_source_ref: "lode://site-capability/xiaohongshu/draft-precheck@0.1.0",
      package_ref: "lode://site-capability/xiaohongshu/draft-precheck@0.1.0",
    },
    admission: { action_risk: "write" },
  },
  {
    schema_version: "webenvoy.run-query.v0",
    run_id: "run_owner_real_site_write_preview_page_changed_001",
    status: "failed",
    timeline: { updated_at: "2026-07-06T11:15:01.000Z", terminal_at: "2026-07-06T11:15:01.000Z" },
    task: {
      capability_ref: "lode:capability/xiaohongshu-draft-precheck",
      capability_version: "0.1.0",
      capability_source_ref: "lode://site-capability/xiaohongshu/draft-precheck@0.1.0",
      package_ref: "lode://site-capability/xiaohongshu/draft-precheck@0.1.0",
    },
    admission: { action_risk: "write" },
  },
];
const bossWritePreviewRuns = [
  {
    schema_version: "webenvoy.run-query.v0",
    run_id: "run_owner_boss_preview_unavailable_001",
    status: "succeeded",
    timeline: { updated_at: "2026-07-06T11:20:01.000Z", terminal_at: "2026-07-06T11:20:01.000Z" },
    task: {
      capability_ref: "lode:capability/boss-greeting-precheck",
      capability_version: "0.1.0",
      capability_source_ref: "lode://site-capability/boss/greeting-precheck@0.1.0",
      package_ref: "lode://site-capability/boss/greeting-precheck@0.1.0",
    },
    admission: { action_risk: "write" },
  },
  {
    schema_version: "webenvoy.run-query.v0",
    run_id: "run_owner_boss_blocked_available_missing_action_request_001",
    status: "blocked",
    timeline: { updated_at: "2026-07-06T11:19:30.000Z", terminal_at: "2026-07-06T11:19:30.000Z" },
    task: {
      capability_ref: "lode:capability/boss-greeting-precheck",
      capability_version: "0.1.0",
      capability_source_ref: "lode://site-capability/boss/greeting-precheck@0.1.0",
      package_ref: "lode://site-capability/boss/greeting-precheck@0.1.0",
    },
    admission: { action_risk: "write" },
  },
  {
    schema_version: "webenvoy.run-query.v0",
    run_id: "run_owner_boss_available_unknown_submitted_001",
    status: "succeeded",
    timeline: { updated_at: "2026-07-06T11:19:01.000Z", terminal_at: "2026-07-06T11:19:01.000Z" },
    task: {
      capability_ref: "lode:capability/boss-greeting-precheck",
      capability_version: "0.1.0",
      capability_source_ref: "lode://site-capability/boss/greeting-precheck@0.1.0",
      package_ref: "lode://site-capability/boss/greeting-precheck@0.1.0",
    },
    admission: { action_risk: "write" },
  },
  {
    schema_version: "webenvoy.run-query.v0",
    run_id: "run_owner_boss_available_true_submitted_001",
    status: "succeeded",
    timeline: { updated_at: "2026-07-06T11:18:01.000Z", terminal_at: "2026-07-06T11:18:01.000Z" },
    task: {
      capability_ref: "lode:capability/boss-greeting-precheck",
      capability_version: "0.1.0",
      capability_source_ref: "lode://site-capability/boss/greeting-precheck@0.1.0",
      package_ref: "lode://site-capability/boss/greeting-precheck@0.1.0",
    },
    admission: { action_risk: "write" },
  },
  {
    schema_version: "webenvoy.run-query.v0",
    run_id: "run_owner_boss_generic_blocked_001",
    status: "blocked",
    timeline: { updated_at: "2026-07-06T11:17:01.000Z", terminal_at: "2026-07-06T11:17:01.000Z" },
    task: {
      capability_ref: "lode:capability/boss-greeting-precheck",
      capability_version: "0.1.0",
      capability_source_ref: "lode://site-capability/boss/greeting-precheck@0.1.0",
      package_ref: "lode://site-capability/boss/greeting-precheck@0.1.0",
    },
    admission: { action_risk: "write" },
  },
  {
    schema_version: "webenvoy.run-query.v0",
    run_id: "run_owner_boss_failed_available_false_submitted_001",
    status: "failed",
    timeline: { updated_at: "2026-07-06T11:16:30.000Z", terminal_at: "2026-07-06T11:16:30.000Z" },
    task: {
      capability_ref: "lode:capability/boss-greeting-precheck",
      capability_version: "0.1.0",
      capability_source_ref: "lode://site-capability/boss/greeting-precheck@0.1.0",
      package_ref: "lode://site-capability/boss/greeting-precheck@0.1.0",
    },
    admission: { action_risk: "write" },
  },
  {
    schema_version: "webenvoy.run-query.v0",
    run_id: "run_owner_boss_generic_failed_001",
    status: "failed",
    timeline: { updated_at: "2026-07-06T11:16:01.000Z", terminal_at: "2026-07-06T11:16:01.000Z" },
    task: {
      capability_ref: "lode:capability/boss-greeting-precheck",
      capability_version: "0.1.0",
      capability_source_ref: "lode://site-capability/boss/greeting-precheck@0.1.0",
      package_ref: "lode://site-capability/boss/greeting-precheck@0.1.0",
    },
    admission: { action_risk: "write" },
  },
];
globalThis.fetch = async (url) => {
  const pathname = String(url);
  const runId = decodeURIComponent(pathname.match(/\/runs\/([^/]+)/)?.[1] ?? "");
  const json = pathname.includes("/capability-runs") && pathname.includes("xiaohongshu-draft-precheck")
    ? { ok: true, capability_runs: { runs: writePreviewRuns } }
    : pathname.includes("/capability-runs") && pathname.includes("boss-greeting-precheck")
    ? { ok: true, capability_runs: { runs: bossWritePreviewRuns } }
    : pathname.endsWith("/result") && runId.includes("page_changed")
    ? {
        ok: true,
        result: {
          schema_version: "webenvoy.result-query.v0",
          run_id: runId,
          status: "failed",
          terminal: true,
          failure: { code: "page_changed", category: "page_state", phase: "precheck" },
          result: {
            envelope_state: "available",
            payload_state: "not_persisted_in_core",
            result_envelope: {
              result_kind: "real_page_write_precheck_projection",
              preview_result: {
                schema_version: "webenvoy.preview-result.v0",
                state: "available",
                submitted: false,
                expected_change: { summary: "Page changed after the write-precheck preview was captured." },
                action_refs: { action_request_id: "action-request:intent_real_site_xiaohongshu_page_changed" },
              },
              failure: { code: "page_changed", category: "page_state", phase: "precheck" },
            },
          },
          evidence_refs: [],
        },
      }
    : pathname.endsWith("/result") && runId.includes("expired")
    ? {
        ok: true,
        result: {
          schema_version: "webenvoy.result-query.v0",
          run_id: runId,
          status: "expired",
          terminal: true,
          result: {
            envelope_state: "available",
            payload_state: "expired",
            result_envelope: {
              result_kind: "real_page_write_precheck_projection",
              preview_result: {
                schema_version: "webenvoy.preview-result.v0",
                state: "available",
                submitted: false,
                expected_change: { summary: "Expired owner run still returned a stale preview." },
                action_refs: { action_request_id: "action-request:intent_real_site_xiaohongshu_expired" },
              },
            },
          },
          evidence_refs: [],
        },
      }
    : pathname.endsWith("/result") && runId.includes("boss_preview_unavailable")
    ? {
        ok: true,
        result: {
          schema_version: "webenvoy.result-query.v0",
          run_id: runId,
          status: "succeeded",
          terminal: true,
          result: {
            envelope_state: "available",
            payload_state: "not_persisted_in_core",
            result_envelope: {
              result_kind: "real_page_write_precheck_projection",
              preview_result: {
                schema_version: "webenvoy.preview-result.v0",
                state: "preview_unavailable",
                submitted: false,
                expected_change: {
                  summary: "BOSS 打招呼写前验证不可用，不发送消息。",
                  target_ref: "harbor:writable-target/boss/greeting-box",
                  external_submit: false,
                },
                action_refs: { action_request_id: "action-request:intent_real_site_boss_greeting_preview_unavailable" },
                capability: {
                  capability_ref: "lode:capability/boss-greeting-precheck",
                  capability_version: "0.1.0",
                  capability_source_ref: "lode://site-capability/boss/greeting-precheck@0.1.0",
                },
                evidence_refs: ["harbor:evidence/boss/greeting/preview-result-only"],
                consumer_boundary: "Core blocked this preview before approval; it is not submitted.",
              },
            },
          },
          evidence_refs: [],
        },
      }
    : pathname.endsWith("/result") && runId.includes("boss_blocked_available_missing_action_request")
    ? {
        ok: true,
        result: {
          schema_version: "webenvoy.result-query.v0",
          run_id: runId,
          status: "blocked",
          terminal: true,
          result: {
            envelope_state: "available",
            payload_state: "not_persisted_in_core",
            result_envelope: {
              result_kind: "real_page_write_precheck_projection",
              preview_result: {
                schema_version: "webenvoy.preview-result.v0",
                state: "available",
                submitted: false,
                expected_change: { summary: "BOSS message preview conflicts with a blocked owner run." },
              },
            },
          },
          evidence_refs: [],
        },
      }
    : pathname.endsWith("/result") && runId.includes("boss_available_unknown_submitted")
    ? {
        ok: true,
        result: {
          schema_version: "webenvoy.result-query.v0",
          run_id: runId,
          status: "succeeded",
          terminal: true,
          result: {
            envelope_state: "available",
            payload_state: "not_persisted_in_core",
            result_envelope: {
              result_kind: "real_page_write_precheck_projection",
              preview_result: {
                schema_version: "webenvoy.preview-result.v0",
                state: "available",
                expected_change: { summary: "BOSS message preview missing submitted owner truth." },
                action_refs: { action_request_id: "action-request:intent_real_site_boss_greeting_unknown_submitted" },
              },
            },
          },
          evidence_refs: [],
        },
      }
    : pathname.endsWith("/result") && runId.includes("boss_available_true_submitted")
    ? {
        ok: true,
        result: {
          schema_version: "webenvoy.result-query.v0",
          run_id: runId,
          status: "succeeded",
          terminal: true,
          result: {
            envelope_state: "available",
            payload_state: "not_persisted_in_core",
            result_envelope: {
              result_kind: "real_page_write_precheck_projection",
              preview_result: {
                schema_version: "webenvoy.preview-result.v0",
                state: "available",
                submitted: true,
                expected_change: { summary: "BOSS message preview reported submitted true." },
                action_refs: { action_request_id: "action-request:intent_real_site_boss_greeting_true_submitted" },
              },
            },
          },
          evidence_refs: [],
        },
      }
    : pathname.endsWith("/result") && runId.includes("boss_failed_available_false_submitted")
    ? {
        ok: true,
        result: {
          schema_version: "webenvoy.result-query.v0",
          run_id: runId,
          status: "failed",
          terminal: true,
          result: {
            envelope_state: "available",
            payload_state: "not_persisted_in_core",
            result_envelope: {
              result_kind: "real_page_write_precheck_projection",
              preview_result: {
                schema_version: "webenvoy.preview-result.v0",
                state: "available",
                submitted: false,
                expected_change: { summary: "BOSS failed owner run still returned preview.available + submitted=false." },
                action_refs: { action_request_id: "action-request:intent_real_site_boss_failed_available_false" },
              },
            },
          },
          evidence_refs: [],
        },
      }
    : pathname.endsWith("/result") && runId.includes("boss_generic_")
    ? {
        ok: true,
        result: {
          schema_version: "webenvoy.result-query.v0",
          run_id: runId,
          status: runId.includes("failed") ? "failed" : "blocked",
          terminal: true,
          result: { envelope_state: "unavailable", payload_state: "not_reported" },
          evidence_refs: [],
        },
      }
    : pathname.endsWith("/result")
    ? {
        ok: true,
        result: {
          schema_version: "webenvoy.result-query.v0",
          run_id: runId,
          status: runId.includes("cancelled") ? "cancelled" : "succeeded",
          terminal: true,
          result: {
            envelope_state: "available",
            payload_state: "not_persisted_in_core",
            result_envelope: {
              result_kind: "real_page_write_precheck_projection",
              preview_result: {
                schema_version: "webenvoy.preview-result.v0",
                state: "available",
                submitted: false,
                expected_change: {
                  summary: "预览小红书草稿编辑器可写字段和预期草稿变化，不保存、不发布。",
                  target_ref: "harbor:writable-target/xiaohongshu/draft-editor",
                  external_submit: false,
                },
                action_refs: { action_request_id: "action-request:intent_real_site_xiaohongshu_draft_preview" },
                capability: {
                  capability_ref: "lode:capability/xiaohongshu-draft-precheck",
                  capability_version: "0.1.0",
                  capability_source_ref: "lode://site-capability/xiaohongshu/draft-precheck@0.1.0",
                },
                evidence_refs: [
                  "harbor:evidence/xiaohongshu/draft-editor/precheck",
                  "harbor:evidence/xiaohongshu/draft-editor/preview-result-only",
                ],
                consumer_boundary: "Core preview result is validate-only/draft/preview projection; it is not submitted result.",
              },
            },
          },
          evidence_refs: [
            {
              ref: "harbor:evidence/xiaohongshu/draft-editor/precheck",
              source: "terminal",
              state: "available",
              raw_access: "not_available_from_core",
              recorded_at: "2026-07-06T11:00:04.000Z",
              runtime_session_ref: "harbor:runtime-session/xiaohongshu/write-precheck",
            },
          ],
        },
      }
    : pathname.endsWith("/evidence-refs")
    ? { ok: true, evidence: { evidence_refs: [] } }
    : pathname.endsWith("/failure")
    ? { ok: true, failure_reason: { reason_class: "none", app_action: "none", retryable: false } }
    : pathname.endsWith("/session-refs")
    ? { ok: true, session_refs: { session_refs: { runtime_session_ref: "harbor:runtime-session/xiaohongshu/write-precheck" } } }
    : { ok: true, capability_runs: { runs: [] } };
  return coreJsonResponse(json);
};
const writePreviewState = await coreReadTaskClientModule.fetchCoreReadTaskState("http://core.test", [
  {
    id: "task-xhs-publish-write-preview",
    title: "小红书发布草稿写前验证",
    accountIdentity: "小红书运营号 A",
    siteSkill: "小红书发布草稿写前预览",
    businessInput: "笔记标题：AI 工具清单",
    source: "Core fixture",
    packageSource: {
      name: "@lode/xiaohongshu-write-pre-preview",
      version: "0.1.0",
      capabilityRef: "lode://capability/xiaohongshu/publish-draft-write-preview",
      sourceRef: "lode://package/xiaohongshu-write-pre-preview@0.1.0",
      fetchedAt: "fixture",
      source: "Lode fixture",
      boundary: "fixture",
    },
    runs: [],
  },
  {
    id: "task-boss-greeting-write-preview",
    title: "BOSS 打招呼写前验证",
    accountIdentity: "BOSS 招聘号",
    siteSkill: "BOSS 打招呼写前预览",
    businessInput: "候选人：前端工程师",
    source: "Core fixture",
    packageSource: {
      name: "@lode/boss-greeting-write-pre-preview",
      version: "0.1.0",
      capabilityRef: "lode://capability/boss/greeting-write-preview",
      sourceRef: "lode://package/boss-greeting-write-pre-preview@0.1.0",
      fetchedAt: "fixture",
      source: "Lode fixture",
      boundary: "fixture",
    },
    runs: [],
  },
]);
globalThis.fetch = originalFetch;

const writePreviewTask = writePreviewState.tasks.find((task) => task.id === "task-xhs-publish-write-preview");
const bossWritePreviewTask = writePreviewState.tasks.find((task) => task.id === "task-boss-greeting-write-preview");

if (!writePreviewTask || !bossWritePreviewTask) {
  throw new Error("Core write-precheck smoke failed: expected live write-precheck tasks are missing.");
}

const writePreviewStates = writePreviewTask.runs.map((run) => run.writePrecheck?.state);

if (writePreviewState.status !== "ready" || writePreviewTask.source !== "Core live" || bossWritePreviewTask.source !== "Core live") {
  throw new Error("Core write-precheck smoke failed: live Core projection was not applied.");
}

for (const expectedState of ["available", "user_cancelled", "expired", "page_changed"]) {
  if (!writePreviewStates.includes(expectedState)) {
    throw new Error(`Core write-precheck smoke failed: ${expectedState} state was not projected.`);
  }
}

if (!writePreviewTask.runs.some((run) => run.resultRows.some((row) => row.label === "Submitted" && row.value === "false / 未提交"))) {
  throw new Error("Core write-precheck smoke failed: submitted=false boundary is missing when Core reports submitted=false.");
}

if (!writePreviewTask.runs.some((run) => run.fieldSources?.some((field) => field.evidenceRef === "harbor:evidence/xiaohongshu/draft-editor/preview-result-only"))) {
  throw new Error("Core write-precheck smoke failed: preview_result evidence_refs were dropped.");
}

if (!writePreviewTask.runs.some((run) => run.approval?.statuses.some((status) => status.status === "pending"))) {
  throw new Error("Core write-precheck smoke failed: pending approval state is missing.");
}

if (bossWritePreviewTask.runs.some((run) => run.lifecycle !== "blocked" || run.approval?.statuses.some((status) => status.status === "pending"))) {
  throw new Error("Core BOSS write-precheck smoke failed: unsafe previews were not blocked.");
}

const terminalConflictCases = [
  {
    label: "failed + preview.available + submitted=false",
    run: bossWritePreviewTask.runs.find((run) => run.id.includes("boss_failed_available_false_submitted")),
    status: "failed",
    state: "preview_unavailable",
    lifecycle: "blocked",
  },
  {
    label: "expired + preview.available + submitted=false",
    run: writePreviewTask.runs.find((run) => run.id.includes("expired")),
    status: "expired",
    state: "expired",
    lifecycle: "blocked",
  },
  {
    label: "cancelled + preview.available + submitted=false",
    run: writePreviewTask.runs.find((run) => run.id.includes("cancelled")),
    status: "cancelled",
    state: "user_cancelled",
    lifecycle: "completed",
  },
  {
    label: "page_changed + preview.available + submitted=false",
    run: writePreviewTask.runs.find((run) => run.id.includes("page_changed")),
    status: "failed",
    state: "page_changed",
    lifecycle: "blocked",
  },
];

for (const { label, run, status, state, lifecycle } of terminalConflictCases) {
  if (!run) {
    throw new Error(`Core write-precheck smoke failed: ${label} fixture is missing.`);
  }
  if (
    run.writePrecheck?.state !== state ||
    run.lifecycle !== lifecycle ||
    run.approval?.riskLevel === "low" ||
    run.approval?.statuses.some((approvalStatus) => approvalStatus.status === "pending") ||
    !run.resultRows.some((row) => row.label === "Run status" && row.value === status) ||
    !run.resultRows.some((row) => row.label === "Submitted" && row.value === "false / 未提交")
  ) {
    throw new Error(`Core write-precheck smoke failed: ${label} was displayed as pending/low approval or lost owner terminal facts.`);
  }
}

if (!bossWritePreviewTask.runs.some((run) => run.resultRows.some((row) => row.label === "Submitted" && row.value === "unknown / blocked"))) {
  throw new Error("Core BOSS write-precheck smoke failed: unknown submitted state was not shown.");
}

if (!bossWritePreviewTask.runs.some((run) => run.resultRows.some((row) => row.label === "Submitted" && row.value === "true / blocked"))) {
  throw new Error("Core BOSS write-precheck smoke failed: submitted=true state was not blocked.");
}

const blockedAvailableRun = bossWritePreviewTask.runs.find((run) => run.id.includes("boss_blocked_available_missing_action_request"));

if (!blockedAvailableRun) {
  throw new Error("Core BOSS write-precheck smoke failed: blocked available conflict fixture is missing.");
}

if (
  blockedAvailableRun.writePrecheck?.state === "available" ||
  blockedAvailableRun.lifecycle !== "blocked" ||
  blockedAvailableRun.approval?.riskLevel === "low" ||
  blockedAvailableRun.approval?.statuses.some((status) => status.status === "pending")
) {
  throw new Error("Core BOSS write-precheck smoke failed: blocked owner state displayed as pending/low approval.");
}

if (blockedAvailableRun.approval?.actionRequestId.startsWith("action-request:")) {
  throw new Error("Core BOSS write-precheck smoke failed: missing action_request_id was synthesized from run_id.");
}

if (!bossWritePreviewTask.runs.some((run) => run.fieldSources?.some((field) => field.evidenceRef === "harbor:evidence/boss/greeting/preview-result-only"))) {
  throw new Error("Core BOSS write-precheck smoke failed: preview_result evidence refs were not projected.");
}

async function assertPackagedRuntimeRequiredFailsClosed() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "webenvoy-runtime-assets-smoke-"));
  try {
    const result = spawnSync(process.execPath, [path.resolve("scripts/package-runtime-assets.mjs")], {
      cwd: tempDir,
      encoding: "utf8",
      env: {
        ...process.env,
        WEBENVOY_REQUIRE_PACKAGED_RUNTIME: "1",
        WEBENVOY_CORE_RUNTIME_SOURCE_DIR: path.join(tempDir, "missing-core"),
        WEBENVOY_HARBOR_RUNTIME_SOURCE_DIR: path.join(tempDir, "missing-harbor"),
      },
    });
    const output = `${result.stdout}\n${result.stderr}`;
    if (result.status === 0 || !output.includes("Packaged runtime assets blocked")) {
      throw new Error(`Runtime asset packaging smoke failed: missing assets did not fail closed. ${output}`);
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function startHarborIdentityContractServer() {
  let created = false;
  let manualAuthenticationCompleted = false;
  let manualAuthenticationRequests = 0;
  let manualAuthenticationAuthorization = "";
  let manualAuthenticationBodyLength = 0;
  const manualAuthenticationToken = "smoke-manual-auth-supervisor-token";
  const identity = harborIdentityFacts();
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const pathname = url.pathname;

    if (request.method === "GET" && ["/runtime/browser-providers", "/runtime/browser-provider-status", "/browser-providers"].includes(pathname)) {
      sendJson(response, 200, harborProviderCatalog());
      return;
    }

    if (request.method === "GET" && ["/runtime/identity-environments", "/identity-environments", "/runtime/local-identity-environments"].includes(pathname)) {
      sendJson(response, 200, { items: created ? [manualAuthenticationCompleted ? harborManualAuthenticationCompletedRecord() : identity] : [] });
      return;
    }

    if (request.method === "POST" && pathname === "/runtime/identity-environment-mutations") {
      const body = await readRequestJson(request);
      const input = body?.identity_environment;
      created = body?.operation === "create" &&
        typeof body?.idempotency_key === "string" &&
        input?.site?.site_id === "xiaohongshu" &&
        input?.site?.account_identifier === "运营号 smoke" &&
        input?.identity_environment_ref == null &&
        input?.execution_identity_ref == null &&
        input?.profile_ref == null &&
        input?.cookie == null &&
        input?.token == null;
      sendJson(response, created ? 201 : 422, {
        schema_version: "harbor-identity-environment-mutation/v1",
        operation: "create",
        status: created ? "completed" : "rejected",
        identity_environment_ref: created ? identity.identity_environment_ref : null,
        source_identity_environment_ref: null,
        record: null,
        effects: { index: created ? "registered" : "unchanged", local_data: created ? "created" : "unchanged", login_state: "unchanged" },
        failure: created ? null : { code: "invalid_request", retryable: false, recovery_actions: [] },
        public_boundary: { output: "status_and_redacted_refs_only", raw_material: "not_exposed", not_exposed: ["cookie", "token", "password", "profile_storage", "local_path"] },
      });
      return;
    }

    if (request.method === "POST" && ["/runtime/identity-environment-sessions", "/runtime/sessions/identity-environment", "/identity-environment-sessions"].includes(pathname)) {
      const body = await readRequestJson(request);
      const managedRefRequest =
        body?.identity_environment_ref === identity.identity_environment_ref &&
        body?.identity_environment == null &&
        body?.headless === false &&
        body?.control_owner === "user";
      sendJson(
        response,
        created && managedRefRequest ? 200 : 409,
        created && managedRefRequest
          ? harborRuntimeSessionFacts(body?.url)
          : { ok: false, error: created ? "managed_identity_ref_required" : "identity_not_created" },
      );
      return;
    }

    if (request.method === "POST" && pathname === "/runtime/sessions/harbor%3Aruntime-session%2Fxhs-contract%2Freadonly/manual-authentication-completed") {
      const body = await readRequestBody(request);
      manualAuthenticationRequests += 1;
      manualAuthenticationAuthorization = request.headers.authorization ?? "";
      manualAuthenticationBodyLength = body.length;
      manualAuthenticationCompleted = created && body.length === 0 && manualAuthenticationAuthorization === `Bearer ${manualAuthenticationToken}`;
      sendJson(
        response,
        manualAuthenticationCompleted ? 200 : 403,
        manualAuthenticationCompleted
          ? harborManualAuthenticationCompletedRecord()
          : { status: "unavailable", failure_class: "manual_authentication_unauthorized", credential: "credential-must-not-leak" },
      );
      return;
    }

    sendJson(response, 404, { status: "missing" });
  });

  await new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not allocate a local Harbor contract smoke port.");
  }

  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    manualAuthenticationToken,
    manualAuthenticationRequests: () => manualAuthenticationRequests,
    manualAuthenticationAuthorization: () => manualAuthenticationAuthorization,
    manualAuthenticationBodyLength: () => manualAuthenticationBodyLength,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

function harborProviderCatalog() {
  return {
    schema_version: "harbor-browser-provider-status/v0",
    providers: [
      {
        provider_id: "cloakbrowser",
        display_name: "CloakBrowser",
        role: "primary",
        install: {
          status: "installed",
          path: "/Applications/CloakBrowser.app",
          version: "smoke",
          launchability: "launchable",
          reason: null,
        },
        limitations: [],
        diagnostics: [{ app_summary: "Local contract smoke provider; no browser was launched.", suggested_action: "none" }],
      },
    ],
    excluded_providers: [{ provider: "chromium", reason: "not identity-stable for production App runtime" }],
  };
}

function harborIdentityFacts() {
  return {
    schema_version: "harbor-local-identity-environment/v0",
    identity_environment_ref: "harbor://identity-environment/xhs-contract",
    execution_identity_ref: "harbor://execution-identity/xhs-contract",
    profile_ref: "harbor://profile/xhs-contract",
    site_binding: {
      site_id: "xiaohongshu",
      origin: "https://www.xiaohongshu.com",
      display_name: "小红书",
      account_label: "运营号 smoke",
    },
    login_state: {
      state: "manual_auth_required",
      reason: "manual authentication required",
      recovery_required: true,
      manual_authentication_state: "required",
      human_verification: ["manual_login"],
    },
    browser_storage: {
      profile_storage_ref: "harbor://profile-storage/xhs-contract",
      state: "present",
      cookies_session_state: "present",
    },
    environment: {
      proxy: { state: "configured", proxy_ref: "proxy:contract", label: "local contract proxy ref" },
      region: "CN-SH",
      language: "zh-CN",
      timezone: "Asia/Shanghai",
      browser_family: "cloakbrowser",
      user_agent_summary: "Chrome family contract",
      viewport: "1440 x 900",
      fingerprint_summary: "provider_claim_contract",
    },
    provider_binding: {
      selected_provider_id: "cloakbrowser",
      selection_reason: "contract_create_readback",
      requires_user_notice: false,
      selected_provider: harborProviderCatalog().providers[0],
      warnings: [],
      unavailable_reason: null,
    },
    credential_recovery: {
      credential_ref: "credential:contract-ref",
      recovery_actions: [],
    },
    diagnostics: [],
  };
}

function harborManualAuthenticationCompletedRecord() {
  return {
    schema_version: "harbor-local-identity-environment-store/v0",
    identity_environment_ref: "harbor://identity-environment/xhs-contract",
    site: {
      site_id: "xiaohongshu",
      origin: "https://www.xiaohongshu.com",
      display_name: "小红书",
      account_ref: "运营号 contract",
    },
    refs: {
      execution_identity_ref: "harbor://execution-identity/xhs-contract",
      profile_ref: "harbor://profile/xhs-contract",
    },
    status: {
      readiness: "ready",
      login_state: "logged_in",
      authentication_provenance: "user_confirmed_managed_session",
      browser_storage_state: "present",
      manual_authentication_state: "completed",
      recovery_required: false,
      blocking_reasons: [],
    },
    environment_summary: {
      provider_id: "cloakbrowser",
      browser_family: "cloakbrowser",
      proxy_state: "configured",
      region: "CN-SH",
      language: "zh-CN",
      timezone: "Asia/Shanghai",
      fingerprint_summary: "provider_claim_contract",
    },
    public_boundary: {
      raw_material: "not_exposed",
      not_exposed: ["password", "verification_code", "cookie", "token", "profile_storage", "raw_evidence"],
    },
    credential: "credential-must-not-leak",
  };
}

function harborRuntimeSessionFacts(requestedUrl) {
  const url = typeof requestedUrl === "string" ? requestedUrl : "https://www.xiaohongshu.com/explore";
  return {
    schema_version: "harbor-runtime-facts/v0",
    runtime_session_ref: "harbor:runtime-session/xhs-contract/readonly",
    provider_ref: "harbor:provider/cloakbrowser",
    lifecycle_state: "active",
    created_at: "2026-07-09T12:00:00.000Z",
    last_seen_at: "2026-07-09T12:00:01.000Z",
    viewer_ref: "harbor:viewer/xhs-contract/readonly",
    current_page: {
      requested_url: url,
      current_url: url,
      title: "小红书 - smoke",
      status: "ready",
    },
    control_owner: "user",
    control_lock: { owner: "user", state: "held" },
    current_error: null,
  };
}

async function readRequestJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (chunks.length === 0) return null;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
}

async function readRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(`${JSON.stringify(body)}\n`);
}

async function startJsonServer(bodyForPath) {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const body = bodyForPath(url.pathname);
    if (body == null) {
      response.writeHead(404, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(`${JSON.stringify({ status: "missing" })}\n`);
      return;
    }
    response.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(`${JSON.stringify(body)}\n`);
  });

  await new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not allocate a local smoke server port.");
  }

  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

console.log("WebEnvoy desktop shell smoke passed.");
process.exit(0);
