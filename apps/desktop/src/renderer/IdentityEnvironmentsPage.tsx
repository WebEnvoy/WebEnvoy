import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Copy,
  LoaderCircle,
  Monitor,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  IdentityEnvironmentManagementPanel,
  type IdentityEditorValue,
  type IdentityManagementMode,
} from "./IdentityEnvironmentManagementPanel";
import { createLatestRequestGate } from "./latestRequestGate";
import {
  completeHarborManualAuthentication,
  fetchHarborIdentityState,
  lockHarborSession,
  openHarborIdentitySession,
  projectHarborSession,
  releaseHarborSession,
  stopHarborSession,
} from "./harborIdentityClient";
import {
  mutateHarborIdentityEnvironment,
  type IdentityEnvironmentBusinessInput,
  type IdentityEnvironmentConfigurationUpdate,
  type IdentityEnvironmentMutationIntent,
} from "./harborIdentityMutationClient";
import { identitySelectionStorageKey, type HarborIdentityLoadState } from "./harborIdentityTypes";
import type { IdentityRecoveryRequest } from "./siteSkillRecovery";
import type {
  BrowserSessionProjection,
  IdentityEnvironmentProjection,
  IdentityStatus,
} from "./identityEnvironmentFixtures";
import { projectRuntimeGatedIdentities, type RuntimeSupervisorState } from "./runtimeSupervisorState";
import type { TaskProjection } from "./taskThreadFixtures";

type PageMode = "catalog" | "detail" | IdentityManagementMode;
type IdentitySort = "recent" | "site";
type ConfirmOperation = "remove" | "delete" | null;

const initialHarborState: HarborIdentityLoadState = { status: "loading", fetchedAt: "pending", summary: "正在读取账号身份。", identities: [], providers: [] };

export function IdentityEnvironmentsPage({
  harborEndpoint,
  initialState = initialHarborState,
  recoveryRequest,
  runtimeSupervisorState,
  tasks,
  onHarborStateChange,
  onOpenLibrary,
  onOpenSettings,
}: {
  harborEndpoint: string;
  initialState?: HarborIdentityLoadState;
  recoveryRequest?: IdentityRecoveryRequest;
  runtimeSupervisorState: RuntimeSupervisorState;
  tasks: TaskProjection[];
  onHarborStateChange: (state: HarborIdentityLoadState) => void;
  onOpenLibrary: () => void;
  onOpenSettings: () => void;
}) {
  const [harborState, setHarborState] = useState(initialState);
  const [selectedId, setSelectedId] = useState(() => window.localStorage.getItem(identitySelectionStorageKey) ?? "");
  const [mode, setMode] = useState<PageMode>("catalog");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [site, setSite] = useState("全部站点");
  const [status, setStatus] = useState("全部状态");
  const [provider, setProvider] = useState("全部 Provider");
  const [sort, setSort] = useState<IdentitySort>("recent");
  const [sessionOverrides, setSessionOverrides] = useState<Record<string, BrowserSessionProjection>>({});
  const [sessionBusy, setSessionBusy] = useState("");
  const [confirmOperation, setConfirmOperation] = useState<ConfirmOperation>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [topbarHost, setTopbarHost] = useState<HTMLElement | null>(null);
  const harborStateRef = useRef(initialState);
  const refreshGateRef = useRef(createLatestRequestGate());
  const mutationRetryRef = useRef<{ intent: string; idempotencyKey: string } | null>(null);
  const handledRecoveryKeyRef = useRef<number | undefined>(undefined);

  const identities = useMemo(
    () => projectRuntimeGatedIdentities(harborState.identities.filter((identity) => identity.source === "Harbor live"), runtimeSupervisorState),
    [harborState.identities, runtimeSupervisorState],
  );
  const selected = identities.find((identity) => identity.id === selectedId);
  const canMutate = harborState.status === "ready" && runtimeSupervisorState.canUseLiveRuntime;
  const selectedSession = selected ? sessionOverrides[selected.id] ?? selected.browser.session : null;
  const environmentLocked = selectedSession?.state === "running" || selectedSession?.state === "takeover";
  const filtered = useMemo(
    () => filterAndSortIdentities(identities, tasks, { provider, query, site, sort, status }),
    [identities, provider, query, site, sort, status, tasks],
  );

  useEffect(() => setTopbarHost(document.getElementById("identity-topbar-actions")), []);
  useEffect(() => { harborStateRef.current = harborState; }, [harborState]);
  useEffect(() => {
    refreshGateRef.current.invalidate();
    void refreshHarborState();
    return () => refreshGateRef.current.invalidate();
  }, [harborEndpoint]);
  useEffect(() => {
    if ((mode === "detail" || mode === "edit") && selected == null) setMode("catalog");
  }, [mode, selected]);
  useEffect(() => {
    if (recoveryRequest == null || handledRecoveryKeyRef.current === recoveryRequest.key) return;
    if (recoveryRequest.identityId == null) {
      handledRecoveryKeyRef.current = recoveryRequest.key;
      if (recoveryRequest.destination === "refresh") void refreshHarborState();
      return;
    }
    const identity = identities.find((candidate) =>
      candidate.id === recoveryRequest.identityId || candidate.identityEnvironmentRef === recoveryRequest.identityId,
    );
    if (identity == null) return;
    handledRecoveryKeyRef.current = recoveryRequest.key;
    setSelectedId(identity.id);
    window.localStorage.setItem(identitySelectionStorageKey, identity.id);
    setMessage("");
    setMode(recoveryRequest.destination === "provider" ? "edit" : "detail");
    if (recoveryRequest.destination === "refresh") void refreshHarborState();
  }, [recoveryRequest?.key, identities]);

  async function refreshHarborState() {
    const request = refreshGateRef.current.begin();
    const next = await fetchHarborIdentityState(harborEndpoint, request.signal);
    if (!request.isCurrent()) return null;
    const current = harborStateRef.current;
    const retained = next.status === "offline" && current.identities.length > 0
      ? { ...next, identities: current.identities, providers: next.providers.length > 0 ? next.providers : current.providers }
      : next;
    harborStateRef.current = retained;
    setHarborState(retained);
    onHarborStateChange(retained);
    return retained;
  }

  function openIdentity(identity: IdentityEnvironmentProjection) {
    setSelectedId(identity.id);
    window.localStorage.setItem(identitySelectionStorageKey, identity.id);
    setMessage("");
    setMode("detail");
  }

  async function runMutation(intent: IdentityEnvironmentMutationIntent) {
    if (!canMutate || busy) return;
    setBusy(true);
    setMessage("正在处理账号身份变更。");
    const serializedIntent = JSON.stringify(intent);
    const retry = mutationRetryRef.current;
    const idempotencyKey: string = retry?.intent === serializedIntent ? retry.idempotencyKey : crypto.randomUUID();
    mutationRetryRef.current = { intent: serializedIntent, idempotencyKey };
    let outcome;
    try {
      outcome = await mutateHarborIdentityEnvironment(harborEndpoint, intent, idempotencyKey);
    } catch {
      setMessage("Harbor 未确认本次变更结果；重试相同操作时会复用本次请求标识。");
      setBusy(false);
      return;
    }
    if (outcome.ok || outcome.result != null) mutationRetryRef.current = null;
    setMessage(outcome.message);
    if (outcome.ok) {
      await refreshHarborState();
      if (intent.operation === "remove" || intent.operation === "delete") {
        setSelectedId("");
        window.localStorage.removeItem(identitySelectionStorageKey);
        setMode("catalog");
      } else {
        const nextId = outcome.result.identity_environment_ref;
        if (nextId) {
          setSelectedId(nextId);
          window.localStorage.setItem(identitySelectionStorageKey, nextId);
        }
        setMode("detail");
      }
    }
    setBusy(false);
    setConfirmOperation(null);
    setDeleteConfirmation("");
  }

  function submitEditor(value: IdentityEditorValue) {
    if (mode === "edit" && selected) {
      void runMutation({ operation: "edit", identity_environment_ref: selected.identityEnvironmentRef, configuration: configuration(value, selected) });
      return;
    }
    const identity_environment = businessInput(value);
    void runMutation(mode === "import"
      ? { operation: "import", identity_environment: { ...identity_environment, import_source_ref: value.importSourceRef } }
      : { operation: "create", identity_environment });
  }

  async function updateSession(action: string, request: () => Promise<unknown>) {
    if (!selected || !canMutate || sessionBusy) return;
    setSessionBusy(action);
    const fallback = sessionOverrides[selected.id] ?? selected.browser.session;
    const result = await request();
    setSessionOverrides((current) => ({ ...current, [selected.id]: projectHarborSession(result as Parameters<typeof projectHarborSession>[0], fallback) }));
    setSessionBusy("");
  }

  function openBrowser() {
    if (!selected) return;
    const target = selected.browser.targets.find((item) => item.id === selected.siteId) ?? selected.browser.targets[0];
    if (target) void updateSession("open", () => openHarborIdentitySession(harborEndpoint, selected, target));
  }

  async function completeAuthentication() {
    if (!selected || !canMutate || sessionBusy) return;
    setSessionBusy("authentication");
    const session = sessionOverrides[selected.id] ?? selected.browser.session;
    const result = await completeHarborManualAuthentication(harborEndpoint, selected, session);
    if (!result.ok) {
      setMessage(result.error);
      setSessionBusy("");
      return;
    }
    const released = await releaseHarborSession(harborEndpoint, session.browserSessionRef);
    setSessionOverrides((current) => ({ ...current, [selected.id]: projectHarborSession(released, session) }));
    setMessage("status" in released ? "登录已确认，但浏览器控制权未释放；请重试。" : "登录状态已由 Harbor 确认，任务可以继续。");
    await refreshHarborState();
    setSessionBusy("");
  }

  const topbarActions = topbarHost && selected && mode === "detail" ? createPortal(
    <IdentityTopbarActions
      busy={busy}
      disabled={!canMutate || environmentLocked}
      onCopy={(operation) => void runMutation({ operation, identity_environment_ref: selected.identityEnvironmentRef })}
      onEdit={() => { setMessage(""); setMode("edit"); }}
    />,
    topbarHost,
  ) : null;

  if (mode === "create" || mode === "import" || mode === "edit") {
    return <div className="identity-page production-identity-page">{topbarActions}<IdentityEnvironmentManagementPanel busy={busy} focusProviderRequestKey={recoveryRequest?.destination === "provider" ? recoveryRequest.key : undefined} identity={selected} message={message} mode={mode} providers={harborState.providers ?? []} onCancel={() => setMode(selected ? "detail" : "catalog")} onSubmit={submitEditor} /></div>;
  }

  if (mode === "catalog") {
    return <div className="identity-page production-identity-page">
      <CatalogHeader canMutate={canMutate} onCreate={() => { setMessage(""); setMode("create"); }} onImport={() => { setMessage(""); setMode("import"); }} onRefresh={() => void refreshHarborState()} />
      {message ? <p className="identity-page-message" role="status">{message}</p> : null}
      {harborState.status === "offline" ? <ConnectionNotice summary={harborState.summary} onRefresh={() => void refreshHarborState()} /> : null}
      <CatalogToolbar provider={provider} query={query} site={site} sort={sort} status={status} onProvider={setProvider} onQuery={setQuery} onSite={setSite} onSort={setSort} onStatus={setStatus} />
      <IdentityCatalog canCreate={canMutate} identities={filtered} hasAny={identities.length > 0} onCreate={() => setMode("create")} onOpen={openIdentity} />
    </div>;
  }

  if (!selected) return null;
  const session = selectedSession ?? selected.browser.session;
  return <div className="identity-page production-identity-page">
    {topbarActions}
    {message ? <p className="identity-page-message" role="status">{message}</p> : null}
    {harborState.status === "offline" ? <ConnectionNotice summary="Harbor 暂不可用，当前仅展示上次读取的状态。" onRefresh={() => void refreshHarborState()} /> : null}
    <IdentityDetail
      identity={selected}
      session={session}
      mutationsDisabled={!canMutate}
      sessionBusy={sessionBusy}
      onBack={() => setMode("catalog")}
      onCompleteAuthentication={() => void completeAuthentication()}
      onOpenBrowser={openBrowser}
      onOpenLibrary={onOpenLibrary}
      onOpenSettings={onOpenSettings}
      onRelease={() => void updateSession("release", () => releaseHarborSession(harborEndpoint, session.browserSessionRef))}
      onStop={() => void updateSession("stop", () => stopHarborSession(harborEndpoint, session.browserSessionRef))}
      onTakeover={() => void updateSession("takeover", () => lockHarborSession(harborEndpoint, session.browserSessionRef))}
      onRemove={() => setConfirmOperation("remove")}
      onDelete={() => setConfirmOperation("delete")}
    />
    {confirmOperation ? <IdentityRemovalDialog accountLabel={selected.accountLabel} deleteConfirmation={deleteConfirmation} operation={confirmOperation} onCancel={() => { setConfirmOperation(null); setDeleteConfirmation(""); }} onConfirmationChange={setDeleteConfirmation} onConfirm={() => void runMutation(confirmOperation === "delete" ? { operation: "delete", identity_environment_ref: selected.identityEnvironmentRef, confirmation: "delete_local_data" } : { operation: "remove", identity_environment_ref: selected.identityEnvironmentRef })} /> : null}
  </div>;
}

function CatalogHeader({ canMutate, onCreate, onImport, onRefresh }: { canMutate: boolean; onCreate: () => void; onImport: () => void; onRefresh: () => void }) {
  return <header className="identity-catalog-header"><div><h1>账号身份</h1><p>管理账号、登录状态与独立浏览器环境。</p></div><div><button className="topbar-icon-button" type="button" aria-label="刷新账号身份" title="刷新账号身份" onClick={onRefresh}><RefreshCw size={14} /></button><button type="button" disabled={!canMutate} onClick={onImport}><Upload size={14} />导入</button><button className="primary" type="button" disabled={!canMutate} onClick={onCreate}><Plus size={14} />创建账号身份</button></div></header>;
}

function CatalogToolbar(props: { provider: string; query: string; site: string; sort: IdentitySort; status: string; onProvider: (value: string) => void; onQuery: (value: string) => void; onSite: (value: string) => void; onSort: (value: IdentitySort) => void; onStatus: (value: string) => void }) {
  return <div className="identity-catalog-toolbar"><label className="identity-search"><Search size={14} /><input aria-label="搜索账号身份" value={props.query} placeholder="搜索账号或站点" onChange={(event) => props.onQuery(event.target.value)} /></label><select aria-label="筛选站点" value={props.site} onChange={(event) => props.onSite(event.target.value)}><option>全部站点</option><option>小红书</option><option>BOSS</option></select><select aria-label="筛选状态" value={props.status} onChange={(event) => props.onStatus(event.target.value)}><option>全部状态</option><option value="ready">可用</option><option value="needs-auth">需要登录</option><option value="blocked">需要修复</option></select><select aria-label="筛选 Provider" value={props.provider} onChange={(event) => props.onProvider(event.target.value)}><option>全部 Provider</option><option>CloakBrowser</option><option>官方 Chrome</option></select><select aria-label="排序" value={props.sort} onChange={(event) => props.onSort(event.target.value as IdentitySort)}><option value="recent">最近使用</option><option value="site">站点名称</option></select></div>;
}

function IdentityCatalog({ canCreate, identities, hasAny, onCreate, onOpen }: { canCreate: boolean; identities: IdentityEnvironmentProjection[]; hasAny: boolean; onCreate: () => void; onOpen: (identity: IdentityEnvironmentProjection) => void }) {
  if (identities.length === 0) return <section className="identity-empty"><CircleAlert size={20} /><h2>{hasAny ? "没有匹配的账号身份" : "尚未创建账号身份"}</h2><p>{hasAny ? "调整搜索或筛选条件。" : "创建后即可打开浏览器或用于站点任务。"}</p>{!hasAny && canCreate ? <button className="primary" type="button" onClick={onCreate}>创建账号身份</button> : null}</section>;
  return <section className="identity-catalog-list" aria-label="账号身份列表">{identities.map((identity) => <button className="identity-catalog-row" type="button" data-identity-ref={identity.identityEnvironmentRef} key={identity.id} onClick={() => onOpen(identity)}><span className="identity-avatar compact">{avatarLabel(identity)}</span><span className="identity-catalog-copy"><strong>{identity.accountLabel}</strong><small>{identity.siteName} · {identity.provider.selected}</small></span><IdentityStatus state={identity.readiness.state} /></button>)}</section>;
}

function IdentityDetail(props: { identity: IdentityEnvironmentProjection; session: BrowserSessionProjection; mutationsDisabled: boolean; sessionBusy: string; onBack: () => void; onCompleteAuthentication: () => void; onOpenBrowser: () => void; onOpenLibrary: () => void; onOpenSettings: () => void; onRelease: () => void; onStop: () => void; onTakeover: () => void; onRemove: () => void; onDelete: () => void }) {
  const { identity, session } = props;
  const running = session.state === "running" || session.state === "takeover";
  const runtimeBlocked = identity.source !== "Harbor live";
  return <>
    <button className="identity-back-link" type="button" onClick={props.onBack}>账号身份</button>
    <header className="identity-detail-title"><span className="identity-avatar">{avatarLabel(identity)}</span><div><h1>{identity.accountLabel}</h1><p><span className="identity-site-tag">{identity.siteName}</span>{identity.login.state} · {identity.provider.selected}</p></div></header>
    <div className="identity-status-line"><IdentityStatus state={identity.readiness.state} /><span>{identity.readiness.label}</span></div>
    <section className="identity-instance-section"><div className="identity-instance-copy"><span className="identity-instance-icon"><Monitor size={18} /></span><div><h2>{running ? "浏览器实例正在运行" : identity.readiness.state === "blocked" ? "浏览器当前不可用" : "浏览器环境已就绪"}</h2><p>{session.title || identity.provider.selected} · {session.statusLabel}</p></div></div><div className="identity-detail-actions"><button className="primary" type="button" disabled={props.mutationsDisabled || runtimeBlocked || Boolean(props.sessionBusy)} onClick={props.onOpenBrowser}><Monitor size={14} />{props.sessionBusy === "open" ? "正在打开" : running ? "聚焦浏览器" : identity.login.recoveryRequired ? "打开浏览器并登录" : "打开浏览器"}</button>{session.state === "running" ? <button type="button" disabled={props.mutationsDisabled || Boolean(props.sessionBusy)} onClick={props.onTakeover}>接管</button> : null}{session.state === "takeover" ? <><button type="button" disabled={props.mutationsDisabled || Boolean(props.sessionBusy)} onClick={props.onCompleteAuthentication}>已完成，继续</button><button type="button" disabled={props.mutationsDisabled || Boolean(props.sessionBusy)} onClick={props.onRelease}>放弃接管</button></> : null}{running ? <button type="button" disabled={props.mutationsDisabled || Boolean(props.sessionBusy)} onClick={props.onStop}>停止实例</button> : null}<button type="button" disabled={identity.readiness.state === "blocked"} onClick={props.onOpenLibrary}>选择技能</button></div></section>
    <section className="identity-environment-section"><div className="identity-section-heading"><div><h2>环境配置</h2><p>由 Harbor 管理的 Provider、代理与浏览器参数。</p></div><button className="inline-link" type="button" onClick={props.onOpenSettings}>检查环境依赖</button></div><dl className="identity-environment-list"><div><dt>Provider</dt><dd>{identity.provider.selected}</dd></div><div><dt>代理</dt><dd>{identity.environment.proxy}</dd></div><div><dt>地区与语言</dt><dd>{identity.environment.region} · {identity.environment.language} · {identity.environment.timezone}</dd></div></dl><details className="identity-profile-details"><summary>高级环境信息</summary><dl className="identity-environment-list"><div><dt>浏览器</dt><dd>{identity.environment.browser}</dd></div><div><dt>视口</dt><dd>{identity.environment.viewport}</dd></div><div><dt>User agent</dt><dd>{identity.environment.userAgent}</dd></div><div><dt>指纹摘要</dt><dd>{identity.environment.fingerprint}</dd></div></dl></details></section>
    <section className="identity-danger-zone"><div><h2>移除账号身份</h2><p>从 App 移除会保留本机数据；删除本机数据不可撤销。</p></div><div><button type="button" disabled={props.mutationsDisabled || Boolean(props.sessionBusy) || running} onClick={props.onRemove}>从 App 移除</button><button className="danger" type="button" disabled={props.mutationsDisabled || Boolean(props.sessionBusy) || running} onClick={props.onDelete}><Trash2 size={14} />删除本机数据</button></div></section>
  </>;
}

function IdentityTopbarActions({ busy, disabled, onCopy, onEdit }: { busy: boolean; disabled: boolean; onCopy: (operation: "copy_full" | "copy_environment") => void; onEdit: () => void }) {
  return <><button className="topbar-icon-button" type="button" aria-label="编辑身份" title="编辑身份" disabled={disabled || busy} onClick={onEdit}><Pencil size={14} /></button><details className="identity-copy-menu" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) event.currentTarget.removeAttribute("open"); }} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.currentTarget.removeAttribute("open"); event.currentTarget.querySelector<HTMLElement>("summary")?.focus(); } }}><summary className="topbar-icon-button" role="button" aria-label="创建副本" title="创建副本" aria-disabled={disabled || busy} onClick={(event) => { if (disabled || busy) event.preventDefault(); }}><Copy size={14} /><ChevronDown size={10} /></summary><div role="menu" aria-label="创建账号身份副本"><button type="button" role="menuitem" onClick={(event) => { onCopy("copy_full"); event.currentTarget.closest("details")?.removeAttribute("open"); }}><strong>完整复制</strong><small>包含账号资料、登录状态和环境配置</small></button><button type="button" role="menuitem" onClick={(event) => { onCopy("copy_environment"); event.currentTarget.closest("details")?.removeAttribute("open"); }}><strong>仅复制环境配置</strong><small>不包含账号资料和站点数据</small></button></div></details></>;
}

function IdentityRemovalDialog({ accountLabel, deleteConfirmation, operation, onCancel, onConfirmationChange, onConfirm }: { accountLabel: string; deleteConfirmation: string; operation: Exclude<ConfirmOperation, null>; onCancel: () => void; onConfirmationChange: (value: string) => void; onConfirm: () => void }) {
  const dialogRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const deleting = operation === "delete";
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex='-1'])") ?? []);
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKeyDown);
    dialogRef.current?.querySelector<HTMLElement>(deleting ? "input" : "footer button")?.focus();
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [deleting]);
  return <div className="identity-dialog-backdrop"><section ref={dialogRef} className="identity-removal-dialog" role="dialog" aria-modal="true" aria-labelledby="identity-removal-title"><button className="topbar-icon-button" type="button" aria-label="关闭" onClick={onCancel}><X size={15} /></button><AlertTriangle size={22} /><h2 id="identity-removal-title">{deleting ? "删除本机数据？" : "从 WebEnvoy 移除？"}</h2><p>{deleting ? "账号身份、浏览器环境和本机站点数据将被删除，此操作不可撤销。" : "账号身份将不再显示，但本机浏览器数据会保留。"}</p>{deleting ? <label>输入“{accountLabel}”确认<input value={deleteConfirmation} onChange={(event) => onConfirmationChange(event.target.value)} /></label> : null}<footer><button type="button" onClick={onCancel}>取消</button><button className={deleting ? "danger" : "primary"} type="button" disabled={deleting && deleteConfirmation !== accountLabel} onClick={onConfirm}>{deleting ? "删除本机数据" : "确认移除"}</button></footer></section></div>;
}

function ConnectionNotice({ summary, onRefresh }: { summary: string; onRefresh: () => void }) {
  return <div className="identity-connection-notice" role="status"><CircleAlert size={16} /><span>{summary}</span><button type="button" onClick={onRefresh}><RefreshCw size={13} />重试</button></div>;
}

function IdentityStatus({ state }: { state: IdentityStatus }) {
  const label = state === "ready" ? "可用" : state === "needs-auth" ? "需要登录" : state === "blocked" ? "需要修复" : state === "warning" ? "受限可用" : "状态未知";
  const Icon = state === "ready" ? CheckCircle2 : state === "unknown" ? LoaderCircle : CircleAlert;
  return <span className={`identity-catalog-status ${state}`} role="status" aria-label={`账号状态：${label}`}><Icon size={13} aria-hidden="true" />{label}</span>;
}

function filterAndSortIdentities(identities: IdentityEnvironmentProjection[], tasks: TaskProjection[], filters: { provider: string; query: string; site: string; sort: IdentitySort; status: string }) {
  const query = filters.query.trim().toLocaleLowerCase("zh-CN");
  const recentUse = new Map(identities.map((identity) => [identity.identityEnvironmentRef, Math.max(0, ...tasks.filter((task) => task.threadContext?.accountIdentityKey === identity.identityEnvironmentRef).map((task) => Date.parse(task.updatedAt ?? "") || 0))]));
  return identities.filter((identity) => (!query || `${identity.accountLabel} ${identity.siteName}`.toLocaleLowerCase("zh-CN").includes(query)) && (filters.site === "全部站点" || identity.siteName === filters.site) && (filters.provider === "全部 Provider" || identity.provider.selected === filters.provider) && (filters.status === "全部状态" || identity.readiness.state === filters.status)).sort((left, right) => filters.sort === "site" ? left.siteName.localeCompare(right.siteName, "zh-CN") || left.accountLabel.localeCompare(right.accountLabel, "zh-CN") : (recentUse.get(right.identityEnvironmentRef) ?? 0) - (recentUse.get(left.identityEnvironmentRef) ?? 0) || left.accountLabel.localeCompare(right.accountLabel, "zh-CN"));
}

function businessInput(value: IdentityEditorValue): IdentityEnvironmentBusinessInput {
  const boss = value.siteId === "boss";
  return { site: { site_id: value.siteId, origin: boss ? "https://www.zhipin.com" : "https://www.xiaohongshu.com", display_name: boss ? "BOSS" : "小红书", account_identifier: value.accountIdentifier }, requested_provider_id: value.providerId, geoip_mode: value.proxyMode === "disabled" ? "disabled" : "system", ...(value.language ? { language: value.language } : {}), ...(value.timezone ? { timezone: value.timezone } : {}), ...(value.viewport ? { viewport: value.viewport } : {}) };
}

function configuration(value: IdentityEditorValue, identity: IdentityEnvironmentProjection) {
  const update: IdentityEnvironmentConfigurationUpdate = {};
  const currentProvider = identity.provider.selected === "官方 Chrome" ? "chrome_official" : "cloakbrowser";
  if (value.providerId !== currentProvider) update.provider_id = value.providerId;
  if (value.proxyMode !== "preserve") {
    update.proxy_ref = null;
    update.proxy_label = null;
    update.geoip_mode = value.proxyMode === "disabled" ? "disabled" : "system";
  }
  if (value.language && value.language !== knownValue(identity.environment.language)) update.language = value.language;
  if (value.timezone && value.timezone !== knownValue(identity.environment.timezone)) update.timezone = value.timezone;
  if (value.viewport && normalizeViewport(value.viewport) !== normalizeViewport(knownValue(identity.environment.viewport))) update.viewport = value.viewport;
  return update;
}

function knownValue(value: string) { return value === "未知" || value === "系统默认" ? "" : value; }
function normalizeViewport(value: string) { return value.replace(/\s*[x×]\s*/i, "x").trim(); }

function avatarLabel(identity: IdentityEnvironmentProjection) {
  return identity.accountLabel.trim().slice(0, 2).toUpperCase() || identity.siteName.slice(0, 1);
}
