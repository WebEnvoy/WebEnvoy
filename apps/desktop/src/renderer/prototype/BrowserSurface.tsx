import {
  Check,
  CircleAlert,
  CircleCheck,
  Dices,
  Download,
  Import,
  KeyRound,
  LoaderCircle,
  Monitor,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  UserRoundPlus,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { Identity, PrototypeTask, ProxyProfile } from "./prototypeData";

type BrowserMode = "catalog" | "detail" | "create" | "repair" | "edit" | "dependencies";

type BrowserSurfaceProps = {
  cloakProviderInstalled: boolean;
  identities: Identity[];
  identity?: Identity;
  initialIdentitySite: string;
  mode: BrowserMode;
  proxies: ProxyProfile[];
  tasks: PrototypeTask[];
  onCreate: (identity: Identity) => void;
  onCreateRequested: () => void;
  onDeleteIdentity: (identityId: string, deleteEnvironment: boolean) => void;
  onLoginCompleted: (identityId: string) => void;
  onManageProxies: () => void;
  onModeChange: (mode: BrowserMode) => void;
  onOpenIdentity: (identityId: string) => void;
  onOpenInstance: (identityId: string) => void;
  onStopInstance: (identityId: string) => void;
  onProviderRepaired: () => void;
  onUpdateIdentity: (identity: Identity) => void;
  onUseSkill: () => void;
};

export function BrowserSurface({
  cloakProviderInstalled,
  identities,
  identity,
  initialIdentitySite,
  mode,
  proxies,
  tasks,
  onCreate,
  onCreateRequested,
  onDeleteIdentity,
  onLoginCompleted,
  onManageProxies,
  onModeChange,
  onOpenIdentity,
  onOpenInstance,
  onStopInstance,
  onProviderRepaired,
  onUpdateIdentity,
  onUseSkill,
}: BrowserSurfaceProps) {
  if (mode === "catalog") return <IdentityCatalog identities={identities} tasks={tasks} onCreate={onCreateRequested} onOpenIdentity={onOpenIdentity} />;
  if (mode === "create") return <CreateIdentity cloakProviderInstalled={cloakProviderInstalled} initialSite={initialIdentitySite} proxies={proxies} onCreate={onCreate} onManageProxies={onManageProxies} />;
  if (mode === "repair") {
    return <ProviderRecovery onDone={() => { onProviderRepaired(); onModeChange("dependencies"); }} />;
  }
  if (mode === "dependencies") {
    return <EnvironmentDependencies cloakProviderInstalled={cloakProviderInstalled} identities={identities} onModeChange={onModeChange} />;
  }
  if (identity == null) return <IdentityCatalog identities={identities} tasks={tasks} onCreate={onCreateRequested} onOpenIdentity={onOpenIdentity} />;
  if (mode === "edit") {
    return <EditIdentity cloakProviderInstalled={cloakProviderInstalled} identity={identity} proxies={proxies} onDelete={onDeleteIdentity} onManageProxies={onManageProxies} onSave={onUpdateIdentity} />;
  }
  return <IdentityDetail identity={identity} onLoginCompleted={onLoginCompleted} onModeChange={onModeChange} onOpenInstance={onOpenInstance} onStopInstance={onStopInstance} onUseSkill={onUseSkill} />;
}

type IdentitySort = "recent" | "site";

function IdentityCatalog({ identities, tasks, onCreate, onOpenIdentity }: { identities: Identity[]; tasks: PrototypeTask[]; onCreate: () => void; onOpenIdentity: (identityId: string) => void }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<IdentitySort>("recent");
  const [site, setSite] = useState("全部站点");
  const [tag, setTag] = useState("全部标签");
  const [status, setStatus] = useState("全部状态");
  const [provider, setProvider] = useState("全部 Provider");
  const orderedIdentities = useMemo(() => sortIdentities(identities, tasks, sort).filter((identity) => {
    const searchable = `${identity.account}${identity.name}${identity.site}${identity.tags?.join("") ?? ""}`.toLowerCase();
    const state = identityStatus(identity).label;
    return searchable.includes(query.trim().toLowerCase())
      && (site === "全部站点" || identity.site === site)
      && (tag === "全部标签" || identity.tags?.includes(tag))
      && (status === "全部状态" || state === status)
      && (provider === "全部 Provider" || identity.provider === provider);
  }), [identities, provider, query, site, sort, status, tag, tasks]);
  const filtersActive = query !== "" || site !== "全部站点" || tag !== "全部标签" || status !== "全部状态" || provider !== "全部 Provider";
  const groups = sort === "site"
    ? Array.from(new Set(orderedIdentities.map((identity) => identity.site))).map((site) => ({ label: site, identities: orderedIdentities.filter((identity) => identity.site === site) }))
    : [{ label: "最近使用", identities: orderedIdentities }];

  return (
    <div className="prototype-page identity-catalog-page">
      <header className="prototype-page-heading"><div><div className="prototype-eyebrow">账号身份</div><h1>账号身份</h1><p>管理站点账号、登录状态和本机浏览器环境。</p></div><button className="prototype-button primary" type="button" onClick={onCreate}><UserRoundPlus size={14} />创建账号身份</button></header>
      <div className="library-toolbar identity-catalog-toolbar">
        <label className="prototype-search"><Search size={15} /><input aria-label="搜索账号身份" value={query} placeholder="搜索账号、身份名称或站点" onChange={(event) => setQuery(event.target.value)} /></label>
        <select aria-label="按站点筛选" value={site} onChange={(event) => setSite(event.target.value)}><option>全部站点</option>{Array.from(new Set(identities.map((identity) => identity.site))).map((value) => <option key={value}>{value}</option>)}</select>
        <select aria-label="按标签筛选" value={tag} onChange={(event) => setTag(event.target.value)}><option>全部标签</option>{Array.from(new Set(identities.flatMap((identity) => identity.tags ?? []))).map((value) => <option key={value}>{value}</option>)}</select>
        <select aria-label="按状态筛选" value={status} onChange={(event) => setStatus(event.target.value)}><option>全部状态</option>{["运行中", "可用", "需要登录", "需要修复"].map((value) => <option key={value}>{value}</option>)}</select>
        <select aria-label="按 Provider 筛选" value={provider} onChange={(event) => setProvider(event.target.value)}><option>全部 Provider</option>{Array.from(new Set(identities.map((identity) => identity.provider))).map((value) => <option key={value}>{value}</option>)}</select>
        <div className="tag-filter" role="group" aria-label="账号身份排序方式"><button className={sort === "recent" ? "selected" : ""} type="button" aria-pressed={sort === "recent"} onClick={() => setSort("recent")}>最近使用</button><button className={sort === "site" ? "selected" : ""} type="button" aria-pressed={sort === "site"} onClick={() => setSort("site")}>站点名称</button></div>
        <span className="identity-result-count">{orderedIdentities.length} 个身份</span>{filtersActive ? <button className="inline-link" type="button" onClick={() => { setQuery(""); setSite("全部站点"); setTag("全部标签"); setStatus("全部状态"); setProvider("全部 Provider"); }}>清除筛选</button> : null}
      </div>
      {orderedIdentities.length === 0 ? <div className="prototype-empty">{identities.length === 0 ? <UserRoundPlus size={24} /> : <Search size={24} />}<h2>{identities.length === 0 ? "尚未创建账号身份" : "没有匹配的账号身份"}</h2><p>{identities.length === 0 ? "创建身份后即可启动浏览器或创建站点任务。" : "调整当前搜索或筛选条件"}</p><button className="prototype-button" type="button" onClick={identities.length === 0 ? onCreate : () => { setQuery(""); setSite("全部站点"); setTag("全部标签"); setStatus("全部状态"); setProvider("全部 Provider"); }}>{identities.length === 0 ? "创建账号身份" : "清除筛选"}</button></div> : null}
      <div className="identity-catalog-groups">{groups.map((group) => group.identities.length > 0 ? <section className="identity-catalog-group" key={group.label}><h2>{group.label}</h2><div className="identity-catalog-list">{group.identities.map((item) => <IdentityCatalogRow identity={item} key={item.id} onOpen={() => onOpenIdentity(item.id)} />)}</div></section> : null)}</div>
    </div>
  );
}

function IdentityCatalogRow({ identity, onOpen }: { identity: Identity; onOpen: () => void }) {
  const status = identityStatus(identity);
  return (
    <div className="identity-catalog-row">
      <button className="identity-catalog-main" type="button" onClick={onOpen}><span className="identity-avatar compact">{identity.accountAvatar ?? identity.account.slice(0, 1)}</span><span><strong>{identity.account}</strong><small>{identity.name} · {identity.site} · {identity.provider}</small></span></button>
      <div className="identity-catalog-actions"><span className={`identity-catalog-status ${status.className}`} role="status">{status.icon}{status.label}</span><button className="prototype-button compact" type="button" onClick={onOpen}>打开</button></div>
    </div>
  );
}

function identityStatus(identity: Identity) {
  if (identity.state === "repair" || identity.sessionState === "failed") return { className: "error", label: "需要修复", icon: <CircleAlert size={13} /> };
  if (identity.loginState === "login-required" || identity.loginState === "unknown") return { className: "warning", label: "需要登录", icon: <CircleAlert size={13} /> };
  if (identity.state === "running" || identity.sessionState === "running") return { className: "running", label: "运行中", icon: <LoaderCircle size={13} /> };
  return { className: "available", label: "可用", icon: <CircleCheck size={13} /> };
}

function sortIdentities(identities: Identity[], tasks: PrototypeTask[], sort: IdentitySort) {
  const latestUse = new Map(identities.map((identity) => [identity.id, Math.max(0, ...tasks.filter((task) => task.identityId === identity.id).map((task) => taskRecency(task.updatedAt)))]));
  return identities.map((identity, index) => ({ identity, index })).sort((left, right) => {
    if (sort === "site") {
      const siteDifference = left.identity.site.localeCompare(right.identity.site, "zh-CN");
      if (siteDifference !== 0) return siteDifference;
    } else {
      const recencyDifference = (latestUse.get(right.identity.id) ?? 0) - (latestUse.get(left.identity.id) ?? 0);
      if (recencyDifference !== 0) return recencyDifference;
    }
    return left.index - right.index;
  }).map(({ identity }) => identity);
}

function taskRecency(label: string) {
  if (label === "刚刚") return 20_000;
  const minutesAgo = label.match(/^(\d+) 分钟前$/);
  if (minutesAgo != null) return 19_000 - Number(minutesAgo[1]);
  const today = label.match(/^今天 (\d{2}):(\d{2})$/);
  if (today != null) return 10_000 + Number(today[1]) * 60 + Number(today[2]);
  return 0;
}

function IdentityDetail({ identity, onLoginCompleted, onModeChange, onOpenInstance, onStopInstance, onUseSkill }: { identity: Identity; onLoginCompleted: (identityId: string) => void; onModeChange: (mode: BrowserMode) => void; onOpenInstance: (identityId: string) => void; onStopInstance: (identityId: string) => void; onUseSkill: () => void }) {
  const unavailable = identity.state === "repair";
  const running = identity.sessionState === "running";
  const sessionFailed = identity.sessionState === "failed";
  const loginReady = identity.loginState === "logged-in" || identity.loginState === "not-required";
  const canCreateTask = !unavailable && !sessionFailed && loginReady;
  const loginLabel = identity.loginState === "logged-in" ? "已登录" : identity.loginState === "not-required" ? "无需登录" : identity.loginState === "login-required" ? "需要登录" : "登录状态未知";
  const loginNote = identity.loginState === "logged-in" ? "14:31 确认" : identity.loginState === "not-required" ? "可直接使用" : identity.loginState === "login-required" ? "等待登录确认" : unavailable ? "待 Provider 恢复后确认" : "等待登录确认";
  return (
    <div className="prototype-page identity-detail-page">
      <header className="prototype-page-heading identity-heading">
        <div className="identity-title-group">
          <span className="identity-avatar">{identity.accountAvatar ?? identity.account.slice(0, 1)}</span>
          <div className="identity-title-copy">
            <h1>{identity.account}</h1>
            <p><span className="identity-site-tag">{identity.site}</span>{identity.name} · {identity.loginState === "not-required" ? "无需登录" : identity.platformId ?? "平台 ID 待同步"}</p>
          </div>
        </div>
      </header>

      <section className="identity-status-line" aria-label="账号身份状态">
        <span className={loginReady ? "ready" : "needs-action"}>{loginReady ? <Check size={13} /> : <CircleAlert size={13} />}<strong>{loginLabel}</strong><small>{loginNote}</small></span>
        <span className={unavailable ? "needs-action" : "ready"}><ShieldCheck size={13} /><strong>{unavailable ? "Provider 未安装" : "环境可用"}</strong></span>
      </section>

      <section className="identity-instance-section">
        <div className="identity-instance-copy">
          <span className="identity-instance-icon"><Monitor size={19} /></span>
          <div>
            <h2>{unavailable ? "浏览器当前不可用" : sessionFailed ? "浏览器实例启动失败" : running ? "浏览器实例正在运行" : identity.loginState === "login-required" ? "登录需要恢复" : "浏览器环境已就绪"}</h2>
            <p>{identity.provider} · {identity.currentPage ?? identity.detail} · {running ? "最近正常" : "实例健康"}：{identity.lastHealthyAt ?? "尚未启动"}</p>
          </div>
        </div>
        <div className="section-actions">
          {identity.loginState === "login-required" && running ? <button className="prototype-button primary" type="button" onClick={() => onLoginCompleted(identity.id)}><Check size={14} />我已完成登录</button> : null}
          <button className="prototype-button primary" type="button" disabled={unavailable} onClick={() => onOpenInstance(identity.id)}><Monitor size={14} />{running ? "聚焦浏览器" : sessionFailed ? "重试启动" : identity.loginState === "login-required" || identity.loginState === "unknown" ? "打开浏览器并登录" : "启动浏览器"}</button>
          {running ? <button className="prototype-button" type="button" onClick={() => onStopInstance(identity.id)}>停止实例</button> : null}
          <button className="prototype-button" type="button" disabled={!canCreateTask} onClick={onUseSkill}><Play size={14} />创建任务</button>
        </div>
      </section>

        <section className="prototype-section identity-environment-section">
          <div className="prototype-section-title"><div><h2>环境配置</h2><p>Provider、代理、地区与浏览器参数</p></div><button className="inline-link" type="button" onClick={() => onModeChange("dependencies")}>检查环境依赖</button></div>
          <dl className="prototype-detail-list">
            <div><dt>Provider</dt><dd>{identity.provider}</dd></div>
            <div><dt>地区与语言</dt><dd>{identity.region ?? "跟随 IP"} · {identity.language ?? "跟随 IP"} · {identity.timezone ?? "跟随 IP"}</dd></div>
            <div><dt>代理</dt><dd>{identity.proxy ?? "团队推荐线路"} · 可用</dd></div>
            <div><dt>启动页面</dt><dd>{identity.startPage ?? "站点首页"}</dd></div>
          </dl>
          <details className="identity-profile-details"><summary>浏览器配置详情</summary><dl className="prototype-detail-list"><div><dt>平台</dt><dd>{identity.platform ?? "跟随 Provider"}</dd></div><div><dt>指纹摘要</dt><dd>{identity.fingerprint ?? "Provider 默认指纹"}</dd></div><div><dt>User agent</dt><dd>{identity.userAgent ?? "跟随 Provider 稳定版本"}</dd></div><div><dt>屏幕</dt><dd>{identity.screen ?? "跟随本机显示器"}</dd></div><div><dt>硬件并发</dt><dd>{identity.hardwareConcurrency ?? "Provider 推荐"}</dd></div><div><dt>GPU</dt><dd>{identity.gpuPreset ?? "Provider 推荐"}</dd></div><div><dt>操作速度</dt><dd>{normalizeInteractionPreset(identity.interactionPreset)}</dd></div><div><dt>当前页面</dt><dd>{identity.currentPage ?? "未打开"}</dd></div><div><dt>最近正常</dt><dd>{identity.lastHealthyAt ?? "尚未验证"}</dd></div><div><dt>存储</dt><dd>本机持久环境 · 已隔离</dd></div></dl></details>
        </section>
    </div>
  );
}

function EditIdentity({ cloakProviderInstalled, identity, proxies, onDelete, onManageProxies, onSave }: { cloakProviderInstalled: boolean; identity: Identity; proxies: ProxyProfile[]; onDelete: (identityId: string, deleteEnvironment: boolean) => void; onManageProxies: () => void; onSave: (identity: Identity) => void }) {
  const [name, setName] = useState(identity.name);
  const [provider, setProvider] = useState(identity.provider);
  const [profile, setProfile] = useState<ProfilePreset>(() => profileFromIdentity(identity));
  const [region, setRegion] = useState(identity.region ?? "中国大陆");
  const [language, setLanguage] = useState(identity.language ?? "简体中文");
  const [timezone, setTimezone] = useState(identity.timezone ?? "跟随 IP");
  const [proxy, setProxy] = useState(identity.proxy ?? "团队推荐线路");
  const [startPage, setStartPage] = useState(identity.startPage ?? defaultStartPage(identity.site));
  const [tags, setTags] = useState((identity.tags ?? []).join("，"));
  const [interactionPreset, setInteractionPreset] = useState(normalizeInteractionPreset(identity.interactionPreset));
  const [fingerprintSeed, setFingerprintSeed] = useState(identity.fingerprintSeed ?? createFingerprintSeed());
  const [randomized, setRandomized] = useState(false);
  const [pathOpened, setPathOpened] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [proxyCheck, setProxyCheck] = useState<"idle" | "checking" | "success" | "conflict">("idle");
  const deleteTriggerRef = useRef<HTMLButtonElement | null>(null);
  const deleteCancelRef = useRef<HTMLButtonElement | null>(null);
  const proxyCheckRequestRef = useRef(0);
  const initialFormRenderRef = useRef(true);
  const running = identity.sessionState === "running";

  useEffect(() => {
    if (deleteOpen) window.requestAnimationFrame(() => deleteCancelRef.current?.focus());
  }, [deleteOpen]);

  useEffect(() => {
    if (initialFormRenderRef.current) {
      initialFormRenderRef.current = false;
      return;
    }
    proxyCheckRequestRef.current += 1;
    setProxyCheck((current) => current === "checking" || current === "success" ? "idle" : current);
  }, [fingerprintSeed, interactionPreset, language, name, profile, provider, proxy, region, startPage, tags, timezone]);

  useEffect(() => () => {
    proxyCheckRequestRef.current += 1;
  }, []);

  function randomizeProfile() {
    setProfile(randomProfileAlternative(profile));
    setFingerprintSeed(createFingerprintSeed());
    setRandomized(true);
  }

  function saveChanges() {
    const snapshot = { name, provider, profile, region, language, timezone, proxy, startPage, tags, interactionPreset, fingerprintSeed };
    if (snapshot.proxy !== "不使用代理") {
      const requestId = ++proxyCheckRequestRef.current;
      setProxyCheck("checking");
      window.setTimeout(() => {
        if (proxyCheckRequestRef.current !== requestId) return;
        if (snapshot.proxy === "日本采集线路" && identity.site !== "抖音") {
          setProxyCheck("conflict");
          return;
        }
        setProxyCheck("success");
        commitChanges(snapshot);
      }, 700);
      return;
    }
    commitChanges(snapshot);
  }

  function commitChanges(snapshot: { name: string; provider: string; profile: ProfilePreset; region: string; language: string; timezone: string; proxy: string; startPage: string; tags: string; interactionPreset: string; fingerprintSeed: string }) {
    const providerUnavailable = snapshot.provider === "CloakBrowser" && !cloakProviderInstalled;
    const providerChanged = snapshot.provider !== identity.provider;
    const providerRecovered = identity.state === "repair" && !providerUnavailable;
    const loginConfirmed = (identity.loginState === "logged-in" || identity.loginState === "not-required") && !providerChanged;
    const providerReset = providerChanged || providerRecovered;
    onSave({
      ...identity,
      name: snapshot.name,
      provider: snapshot.provider,
      region: snapshot.region,
      language: snapshot.language,
      timezone: snapshot.timezone,
      proxy: snapshot.proxy,
      startPage: snapshot.startPage,
      platform: snapshot.profile.platform,
      screen: snapshot.profile.screen,
      hardwareConcurrency: snapshot.profile.hardwareConcurrency,
      gpuPreset: snapshot.profile.gpuPreset,
      interactionPreset: snapshot.interactionPreset,
      fingerprintSeed: snapshot.fingerprintSeed,
      tags: snapshot.tags.split(/[，,]/).map((tag) => tag.trim()).filter(Boolean),
      state: providerUnavailable ? "repair" : providerReset ? loginConfirmed ? "available" : "login" : identity.state,
      stateLabel: providerUnavailable ? "需要修复" : providerReset ? loginConfirmed ? "可用" : "需要登录" : identity.stateLabel,
      loginState: providerChanged && identity.loginState !== "not-required" ? "unknown" : identity.loginState,
      sessionState: providerUnavailable ? "failed" : providerReset ? "idle" : identity.sessionState,
      controller: providerReset ? "空闲" : identity.controller,
      currentPage: providerChanged ? undefined : identity.currentPage,
      fingerprint: providerChanged ? "待首次启动生成" : identity.fingerprint,
      userAgent: providerChanged ? "待首次启动确认" : identity.userAgent,
      lastHealthyAt: providerReset ? "尚未启动" : identity.lastHealthyAt,
      detail: providerUnavailable ? "CloakBrowser 未安装" : providerReset ? loginConfirmed ? "空闲 · Provider 启动验证通过" : "Provider 已验证 · 等待登录确认" : identity.detail,
    });
  }

  return (
    <div className="prototype-page edit-identity-page">
      <header className="prototype-page-heading"><div><div className="prototype-eyebrow">账号身份</div><h1>编辑 {identity.account}</h1><p>在一个页面统一管理站点账号信息和持久浏览器环境。</p></div></header>
      <form className="prototype-form identity-form" onSubmit={(event) => { event.preventDefault(); saveChanges(); }}>
        <fieldset><legend>{identity.loginState === "not-required" ? "浏览器身份" : "站点账号"}</legend><div className="site-account-profile editable-account-profile"><span className="identity-avatar account-avatar">{identity.accountAvatar ?? identity.account.slice(0, 1)}</span><div><strong>{identity.account}</strong><span>{identity.site} · {identity.loginState === "not-required" ? "无需登录" : identity.platformId ?? "平台 ID 待同步"}</span></div><span className={`prototype-state-chip ${identity.loginState === "logged-in" || identity.loginState === "not-required" ? "available" : "login"}`}>{identity.loginState === "logged-in" ? "已登录" : identity.loginState === "not-required" ? "无需登录" : "待登录"}</span></div><p className="muted-copy">{identity.loginState === "not-required" ? "这个环境不预置站点登录状态；以后仍可在浏览器中人工登录。" : "昵称、头像、平台 ID 和登录状态由登录校验同步，不能在本地修改。"}</p><div className="inline-form-grid"><label>本地身份名称<input required value={name} onChange={(event) => setName(event.target.value)} /></label><label>标签<input value={tags} placeholder="内容运营，品牌号" onChange={(event) => setTags(event.target.value)} /></label></div></fieldset>
        {running ? <section className="prototype-callout action-needed"><CircleAlert size={18} /><div><strong>实例运行中</strong><p>当前只能修改本地名称和标签；停止实例后才能修改环境或删除身份。</p></div></section> : <><fieldset><legend>登录目标</legend><label>目标网站 URL<input type="url" value={startPage} onChange={(event) => setStartPage(event.target.value)} /></label></fieldset><fieldset><legend>浏览器 Provider</legend><ProviderChoices cloakProviderInstalled={cloakProviderInstalled} provider={provider} onChange={setProvider} /></fieldset><ProfileEnvironmentFields profile={profile} proxy={proxy} proxies={proxies} region={region} language={language} timezone={timezone} interactionPreset={interactionPreset} fingerprintSeed={fingerprintSeed} randomized={randomized} onManageProxies={onManageProxies} onProfileChange={setProfile} onProxyChange={(value) => { setProxy(value); setProxyCheck("idle"); }} onRegionChange={setRegion} onLanguageChange={setLanguage} onTimezoneChange={setTimezone} onInteractionPresetChange={setInteractionPreset} onFingerprintSeedChange={setFingerprintSeed} onRandomize={randomizeProfile} /><fieldset><legend>本机环境</legend><div className="environment-path-row"><span><strong>数据目录</strong><small>~/Library/Application Support/WebEnvoy/profiles/{identity.id}</small></span><button className="prototype-button" type="button" onClick={() => setPathOpened(true)}>{pathOpened ? "已在访达中显示" : "在访达中显示"}</button></div><p className="muted-copy">删除身份、清理本机环境等操作集中在这里管理。</p></fieldset></>}
        {proxyCheck !== "idle" ? <section className={`prototype-callout ${proxyCheck === "conflict" ? "action-needed" : ""}`} aria-live="polite">{proxyCheck === "checking" ? <LoaderCircle size={18} /> : proxyCheck === "success" ? <Check size={18} /> : <CircleAlert size={18} />}<div><strong>{proxyCheck === "checking" ? `正在检查 ${identity.site} 网络` : proxyCheck === "success" ? "目标站点网络检查通过" : "代理与当前站点配置冲突"}</strong><p>{proxyCheck === "conflict" ? "当前出口地区不适合这个身份。请选择其他代理或不使用代理后重试。" : proxyCheck === "checking" ? "正在检查目标可达性、出口地区和配置冲突。" : "代理对当前目标可达，身份设置已保存。"}</p></div>{proxyCheck === "conflict" ? <button className="prototype-button" type="button" onClick={() => { setProxy("团队推荐线路"); setProxyCheck("idle"); }}>改用推荐线路</button> : null}</section> : null}
        {deleteOpen && !running ? <section className="prototype-section identity-delete-confirmation" role="group" aria-labelledby="identity-delete-title"><h2 id="identity-delete-title">删除账号身份</h2><p>历史任务会保留账号名称并标记身份已删除。</p><div className="section-actions"><button ref={deleteCancelRef} className="prototype-button" type="button" onClick={() => { setDeleteOpen(false); window.setTimeout(() => deleteTriggerRef.current?.focus(), 0); }}>取消</button><button className="prototype-button danger" type="button" onClick={() => onDelete(identity.id, false)}>仅从 App 移除</button><button className="prototype-button danger" type="button" onClick={() => onDelete(identity.id, true)}>同时删除本机环境</button></div></section> : null}
        <div className="form-footer"><button ref={deleteTriggerRef} className="prototype-button danger" type="button" disabled={running} title={running ? "请先停止实例" : "删除账号身份"} onClick={() => setDeleteOpen(true)}>删除账号身份</button><button className="prototype-button primary" type="submit" disabled={proxyCheck === "checking"}>保存更改</button></div>
      </form>
    </div>
  );
}

function EnvironmentDependencies({ cloakProviderInstalled, identities, onModeChange }: { cloakProviderInstalled: boolean; identities: Identity[]; onModeChange: (mode: BrowserMode) => void }) {
  const cloakDependents = identities.filter((identity) => identity.provider === "CloakBrowser").length;
  const cloakNeedsRepair = !cloakProviderInstalled;
  const [lastChecked, setLastChecked] = useState<"cloak" | "chrome" | null>(null);
  return (
    <div className="prototype-page environment-dependencies-page">
      <header className="prototype-page-heading"><div><div className="prototype-eyebrow">本机环境</div><h1>环境依赖</h1><p>集中检测、安装、更新和修复本机浏览器 Provider。</p></div></header>
      <div className="provider-dependency-list">
        <section className={`provider-dependency-row ${cloakNeedsRepair ? "needs-action" : ""}`}><span className="provider-dependency-icon"><ShieldCheck size={20} /></span><div><h2>CloakBrowser</h2><p>{cloakNeedsRepair ? "未安装" : "版本 126.4 · 启动验证通过"} · {cloakDependents} 个账号身份使用</p><small>{lastChecked === "cloak" ? "刚刚完成检测" : "首次使用时从 CloakBrowser 官方渠道下载，不随 App 分发"}</small></div><span className={`prototype-state-chip ${cloakNeedsRepair ? "repair" : "available"}`}>{cloakNeedsRepair ? <CircleAlert size={13} /> : <Check size={13} />}{cloakNeedsRepair ? "需要安装" : "可用"}</span><button className={`prototype-button ${cloakNeedsRepair ? "primary" : ""}`} type="button" onClick={() => cloakNeedsRepair ? onModeChange("repair") : setLastChecked("cloak")}>{cloakNeedsRepair ? <Download size={14} /> : <RefreshCw size={14} />}{cloakNeedsRepair ? "从官方渠道安装" : lastChecked === "cloak" ? "检测完成" : "重新检测"}</button></section>
        <section className="provider-dependency-row"><span className="provider-dependency-icon"><Monitor size={20} /></span><div><h2>官方 Chrome</h2><p>版本 126.0.6478.127 · 启动验证通过</p><small>{lastChecked === "chrome" ? "刚刚完成检测" : "/Applications/Google Chrome.app"}</small></div><span className="prototype-state-chip available"><Check size={13} />可用</span><button className="prototype-button" type="button" onClick={() => setLastChecked("chrome")}><RefreshCw size={14} />{lastChecked === "chrome" ? "检测完成" : "重新检测"}</button></section>
      </div>
      <section className="prototype-section dependency-preferences"><h2>安装与更新</h2><label><input type="checkbox" defaultChecked /> 自动下载 CloakBrowser 安全更新</label><label><input type="checkbox" defaultChecked /> Provider 不可用时通知我</label></section>
    </div>
  );
}

type LoginRequirement = "required" | "not-required";
type ProfilePreset = { platform: NonNullable<Identity["platform"]>; screen: string; hardwareConcurrency: string; gpuPreset: string };

const profilePresets: ProfilePreset[] = [
  { platform: "Windows", screen: "1920 × 1080", hardwareConcurrency: "8 核", gpuPreset: "NVIDIA · 主流桌面" },
  { platform: "macOS", screen: "1440 × 900", hardwareConcurrency: "8 核", gpuPreset: "Apple · 集成图形" },
  { platform: "Linux", screen: "1920 × 1080", hardwareConcurrency: "4 核", gpuPreset: "Intel · 集成图形" },
];

function CreateIdentity({ cloakProviderInstalled, initialSite, proxies, onCreate, onManageProxies }: { cloakProviderInstalled: boolean; initialSite: string; proxies: ProxyProfile[]; onCreate: (identity: Identity) => void; onManageProxies: () => void }) {
  const [loginRequirement, setLoginRequirement] = useState<LoginRequirement>("required");
  const [name, setName] = useState("");
  const [loginUrl, setLoginUrl] = useState(defaultStartPage(initialSite));
  const [provider, setProvider] = useState(cloakProviderInstalled ? "CloakBrowser" : "官方 Chrome");
  const [profile, setProfile] = useState<ProfilePreset>(profilePresets[0]);
  const [region, setRegion] = useState("跟随 IP");
  const [language, setLanguage] = useState("跟随 IP");
  const [timezone, setTimezone] = useState("跟随 IP");
  const [proxy, setProxy] = useState("团队推荐线路");
  const [interactionPreset, setInteractionPreset] = useState("正常速度");
  const [fingerprintSeed, setFingerprintSeed] = useState(createFingerprintSeed);
  const [randomized, setRandomized] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importSource, setImportSource] = useState("Chrome · Profile 2");
  const site = loginRequirement === "required" ? siteFromUrl(loginUrl, initialSite) : initialSite;
  const urlValid = loginRequirement === "not-required" || isHttpUrl(loginUrl);
  const importBlocked = importing && importSource.startsWith("CloakBrowser") && !cloakProviderInstalled;
  const canCreate = !importBlocked && (loginRequirement === "required" ? urlValid : name.trim() !== "");

  function randomizeProfile() {
    setProfile(randomProfileAlternative(profile));
    setFingerprintSeed(createFingerprintSeed());
    setRandomized(true);
  }

  function submitIdentity() {
    const requiresLogin = loginRequirement === "required";
    const identityName = requiresLogin ? `${site}登录身份` : name.trim();
    const selectedProvider = importing ? importSource.split(" · ")[0] : provider;
    onCreate({
      id: `identity-${Date.now()}`, name: identityName, site, account: requiresLogin ? "等待登录同步" : identityName,
      accountAvatar: requiresLogin ? "?" : identityName.slice(0, 1), provider: selectedProvider, region, language, timezone, proxy,
      startPage: requiresLogin ? loginUrl : defaultStartPage(site), tags: [site], platform: profile.platform,
      fingerprintSeed, fingerprint: selectedProvider === "CloakBrowser" ? `独立种子 · ${profile.gpuPreset}` : "Chrome 默认指纹",
      userAgent: `按 ${profile.platform} 预设生成`, screen: profile.screen, hardwareConcurrency: profile.hardwareConcurrency,
      gpuPreset: profile.gpuPreset, interactionPreset, loginState: requiresLogin ? "login-required" : "not-required",
      sessionState: requiresLogin ? "running" : "idle", controller: requiresLogin ? "用户控制" : "空闲",
      currentPage: requiresLogin ? loginUrl : undefined, lastHealthyAt: "刚刚创建",
      state: requiresLogin ? "running" : "available", stateLabel: requiresLogin ? "等待登录" : "可用",
      detail: importing ? `已从 ${importSource} 导入 · 原环境保持不变` : requiresLogin ? "浏览器已打开 · 等待完成登录" : "环境已创建 · 无需预置登录",
      importSource: importing ? importSource : undefined,
    });
  }

  return (
    <div className="prototype-page create-identity-page">
      <header className="prototype-page-heading"><div><div className="prototype-eyebrow">账号身份</div><h1>{importing ? "导入已有环境" : "创建账号身份"}</h1><p>{importing ? "检测本机已有浏览器环境，并以新身份 ID 纳入 App。" : "创建一个独立、持久的浏览器环境；需要时再关联站点账号。"}</p></div><button className="prototype-button" type="button" onClick={() => setImporting((value) => !value)}><Import size={14} />{importing ? "返回创建" : "从已有环境导入"}</button></header>
      <form className="prototype-form identity-form" onSubmit={(event) => { event.preventDefault(); submitIdentity(); }}>
        {importing ? <fieldset><legend>检测到的环境</legend><label>本机环境<select value={importSource} onChange={(event) => setImportSource(event.target.value)}><option>Chrome · Profile 2</option><option>CloakBrowser · marketing-xhs</option></select></label><p className={importBlocked ? "identity-url-status invalid" : "identity-url-status valid"}>{importBlocked ? "CloakBrowser 尚未安装，先修复 Provider 或选择 Chrome 环境。" : `${importSource} 可导入；将保留来源与兼容性记录。`}</p><p className="muted-copy">导入会生成新的身份 ID；原环境保持不变，不读取账号密码。</p></fieldset> : null}
        <fieldset><legend>使用方式</legend><div className="identity-login-choice"><button className={loginRequirement === "required" ? "selected" : ""} type="button" onClick={() => setLoginRequirement("required")}><KeyRound size={17} /><span><strong>需要账号登录</strong><small>打开目标网址，登录后同步账号信息</small></span></button><button className={loginRequirement === "not-required" ? "selected" : ""} type="button" onClick={() => setLoginRequirement("not-required")}><Monitor size={17} /><span><strong>无需账号登录</strong><small>创建一个不预置登录状态的浏览器身份</small></span></button></div></fieldset>
        <fieldset><legend>{loginRequirement === "required" ? "登录目标" : "身份名称"}</legend>{loginRequirement === "required" ? <><label>目标网站 URL<input required type="url" value={loginUrl} placeholder="https://www.example.com/login" onChange={(event) => setLoginUrl(event.target.value)} /></label><p className={`identity-url-status ${urlValid ? "valid" : "invalid"}`}>{urlValid ? `已识别为 ${site}；创建后将用新环境打开此网址。` : "请输入以 http:// 或 https:// 开头的完整网址。"}</p></> : <><label>身份名称<input required value={name} placeholder={`例如：${initialSite}公开浏览`} onChange={(event) => setName(event.target.value)} /></label><p className="muted-copy">适用站点：{initialSite}。该身份只会用于此站点中不要求登录的技能。</p></>}</fieldset>
        <fieldset><legend>浏览器 Provider</legend><ProviderChoices cloakProviderInstalled={cloakProviderInstalled} provider={provider} onChange={setProvider} /></fieldset>
        <ProfileEnvironmentFields profile={profile} proxy={proxy} proxies={proxies} region={region} language={language} timezone={timezone} interactionPreset={interactionPreset} fingerprintSeed={fingerprintSeed} randomized={randomized} onManageProxies={onManageProxies} onProfileChange={setProfile} onProxyChange={setProxy} onRegionChange={setRegion} onLanguageChange={setLanguage} onTimezoneChange={setTimezone} onInteractionPresetChange={setInteractionPreset} onFingerprintSeedChange={setFingerprintSeed} onRandomize={randomizeProfile} />
        <div className="form-footer"><span>{loginRequirement === "required" ? "创建后将拉起独立浏览器，由你完成登录。" : "创建后可直接用于不要求登录的站点技能。"}</span><button className="prototype-button primary" type="submit" disabled={!canCreate}><UserRoundPlus size={14} />{importing ? "导入环境" : loginRequirement === "required" ? "创建环境并去登录" : "创建环境"}</button></div>
      </form>
    </div>
  );
}

function ProviderChoices({ cloakProviderInstalled, provider, onChange }: { cloakProviderInstalled: boolean; provider: string; onChange: (provider: string) => void }) {
  return (
    <div className="provider-choice-list">
      <label className={provider === "CloakBrowser" ? "selected" : ""}>
        <input type="radio" name="provider" disabled={!cloakProviderInstalled} checked={provider === "CloakBrowser"} onChange={() => onChange("CloakBrowser")} />
        <ShieldCheck size={18} />
        <span><strong>CloakBrowser</strong><small>{cloakProviderInstalled ? "独立进程运行 · 由 App 启动和管理" : "尚未安装 · 首次使用从官方渠道下载"}</small></span>
      </label>
      <label className={provider === "官方 Chrome" ? "selected" : ""}>
        <input type="radio" name="provider" checked={provider === "官方 Chrome"} onChange={() => onChange("官方 Chrome")} />
        <Monitor size={18} />
        <span><strong>官方 Chrome</strong><small>使用本机安装 · 部分环境能力受限</small></span>
      </label>
    </div>
  );
}

type ProfileEnvironmentFieldsProps = {
  profile: ProfilePreset;
  proxy: string;
  proxies: ProxyProfile[];
  region: string;
  language: string;
  timezone: string;
  interactionPreset: string;
  fingerprintSeed: string;
  randomized: boolean;
  onManageProxies: () => void;
  onProfileChange: (profile: ProfilePreset) => void;
  onProxyChange: (proxy: string) => void;
  onRegionChange: (region: string) => void;
  onLanguageChange: (language: string) => void;
  onTimezoneChange: (timezone: string) => void;
  onInteractionPresetChange: (preset: string) => void;
  onFingerprintSeedChange: (seed: string) => void;
  onRandomize: () => void;
};

function ProfileEnvironmentFields({ profile, proxy, proxies, region, language, timezone, interactionPreset, fingerprintSeed, randomized, onManageProxies, onProfileChange, onProxyChange, onRegionChange, onLanguageChange, onTimezoneChange, onInteractionPresetChange, onFingerprintSeedChange, onRandomize }: ProfileEnvironmentFieldsProps) {
  const followsIp = region === "跟随 IP" && language === "跟随 IP" && timezone === "跟随 IP";
  const knownScreens = ["1920 × 1080", "1440 × 900", "1366 × 768"];
  const knownConcurrency = ["4 核", "8 核", "12 核", "16 核"];
  return (
    <fieldset className="profile-environment-fieldset">
      <legend>浏览器环境</legend>
      <div className="profile-environment-actions"><button className="prototype-button compact" type="button" onClick={onRandomize}><Dices size={14} />一键随机</button></div>
      <div className="inline-form-grid">
        <label>平台<select value={profile.platform} onChange={(event) => onProfileChange(profilePresets.find((preset) => preset.platform === event.target.value) ?? profilePresets[0])}><option>Windows</option><option>macOS</option><option>Linux</option></select></label>
        <div className="profile-proxy-field"><label>代理<select value={proxy} onChange={(event) => onProxyChange(event.target.value)}>{proxyOptions(proxies)}<option>不使用代理</option></select></label><button className="inline-link field-link" type="button" onClick={onManageProxies}>新增或管理代理</button></div>
      </div>
      <label className="profile-auto-row"><input type="checkbox" checked={followsIp} onChange={(event) => { if (event.target.checked) { onRegionChange("跟随 IP"); onLanguageChange("跟随 IP"); onTimezoneChange("跟随 IP"); } else { onRegionChange("中国大陆"); onLanguageChange("简体中文"); onTimezoneChange("Asia/Shanghai"); } }} /><span><strong>根据代理 IP 自动设置</strong><small>保持地区、语言和时区一致</small></span></label>
      <div className="inline-form-grid three">
        <label>地区<select value={region} onChange={(event) => onRegionChange(event.target.value)}><option>跟随 IP</option><option>跟随本机</option><option>中国大陆</option><option>美国</option><option>日本</option></select></label>
        <label>语言<select value={language} onChange={(event) => onLanguageChange(event.target.value)}><option>跟随 IP</option><option>跟随本机</option><option>简体中文</option><option>English</option></select></label>
        <label>时区<select value={timezone} onChange={(event) => onTimezoneChange(event.target.value)}><option>跟随 IP</option><option>跟随本机</option><option>Asia/Shanghai</option><option>America/Los_Angeles</option></select></label>
      </div>
      {randomized ? <p className="profile-randomized"><Check size={13} />已生成一组相互兼容的设备参数</p> : null}
      <details className="profile-advanced-settings">
        <summary>高级设置<span>指纹、屏幕与设备参数</span></summary>
        <div className="profile-advanced-body">
          <div className="inline-form-grid three">
            <label>屏幕分辨率<select value={profile.screen} onChange={(event) => onProfileChange({ ...profile, screen: event.target.value })}>{knownScreens.includes(profile.screen) ? null : <option>{profile.screen}</option>}{knownScreens.map((screen) => <option key={screen}>{screen}</option>)}</select></label>
            <label>硬件并发<select value={profile.hardwareConcurrency} onChange={(event) => onProfileChange({ ...profile, hardwareConcurrency: event.target.value })}>{knownConcurrency.includes(profile.hardwareConcurrency) ? null : <option>{profile.hardwareConcurrency}</option>}{knownConcurrency.map((value) => <option key={value}>{value}</option>)}</select></label>
            <label>GPU 预设<select value={profile.gpuPreset} onChange={(event) => onProfileChange({ ...profile, gpuPreset: event.target.value })}>{gpuPresets(profile.platform).includes(profile.gpuPreset) ? null : <option>{profile.gpuPreset}</option>}{gpuPresets(profile.platform).map((preset) => <option key={preset}>{preset}</option>)}</select></label>
          </div>
          <div className="inline-form-grid">
            <label>操作速度<select value={interactionPreset} onChange={(event) => onInteractionPresetChange(event.target.value)}><option value="正常速度">正常速度</option><option value="降低速度">降低速度（操作间隔更长）</option></select></label>
            <div className="fingerprint-seed-row"><span><strong>指纹种子</strong><small>当前尾号 {fingerprintSeed.slice(-8)} · 保存后保持稳定</small></span><button className="prototype-button compact" type="button" onClick={() => onFingerprintSeedChange(createFingerprintSeed())}><RefreshCw size={13} />重新生成</button></div>
          </div>
        </div>
      </details>
    </fieldset>
  );
}

function ProviderRecovery({ onDone }: { onDone: () => void }) {
  const [phase, setPhase] = useState<"ready" | "installing" | "complete">("ready");
  const recoveryStatusRef = useRef<HTMLElement | null>(null);
  const doneButtonRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (phase !== "installing") return;
    const timer = window.setTimeout(() => setPhase("complete"), 1400);
    return () => window.clearTimeout(timer);
  }, [phase]);
  useEffect(() => {
    if (phase === "ready") return;
    const frame = window.requestAnimationFrame(() => {
      if (phase === "complete") doneButtonRef.current?.focus();
      else recoveryStatusRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [phase]);
  return (
    <div className="prototype-page provider-recovery-page">
      <header className="prototype-page-heading"><div><div className="prototype-eyebrow">环境依赖</div><h1>{phase === "complete" ? "CloakBrowser 已可用" : "安装 CloakBrowser"}</h1><p>App 只获取官方安装器，浏览器二进制由 CloakBrowser 官方服务器提供。</p></div></header>
      <section ref={recoveryStatusRef} className="recovery-focus" tabIndex={phase === "installing" ? -1 : undefined}><span className={`provider-large-icon ${phase}`}>{phase === "complete" ? <Check size={28} /> : phase === "installing" ? <LoaderCircle size={28} /> : <Download size={28} />}</span><div><h2>{phase === "ready" ? "已找到适用于 macOS 的官方安装器" : phase === "installing" ? "正在从官方渠道下载并安装" : "安装与启动验证通过"}</h2><p>{phase === "ready" ? "浏览器二进制不会打包在 WebEnvoy App 中" : phase === "installing" ? "下载完成后会自动执行完整性检查。" : "浏览器将在独立进程中运行，由 App 启动和管理。"}</p></div>{phase === "ready" ? <button className="prototype-button primary" type="button" onClick={() => setPhase("installing")}><Download size={14} />从官方渠道安装</button> : phase === "complete" ? <button ref={doneButtonRef} className="prototype-button primary" type="button" onClick={onDone}>返回环境依赖</button> : null}</section>
      <div className="recovery-steps"><RecoveryStep done={phase !== "ready"} active={phase === "installing"} label="获取官方安装器" detail="确认来源与版本" /><RecoveryStep done={phase === "complete"} active={phase === "installing"} label="下载浏览器并安装" detail="保留已有账号环境" /><RecoveryStep done={phase === "complete"} active={false} label="启动验证" detail="确认独立进程可启动" /></div>
    </div>
  );
}

function RecoveryStep({ active, detail, done, label }: { active: boolean; detail: string; done: boolean; label: string }) {
  return <div className={`recovery-step ${active ? "active" : ""} ${done ? "done" : ""}`}><span>{done ? <Check size={14} /> : active ? <LoaderCircle size={14} /> : null}</span><div><strong>{label}</strong><small>{detail}</small></div></div>;
}

function defaultStartPage(site: string) {
  if (site === "小红书") return "https://www.xiaohongshu.com/explore";
  if (site === "微信公众号") return "https://mp.weixin.qq.com/";
  if (site === "抖音") return "https://www.douyin.com/";
  if (site === "淘宝") return "https://www.taobao.com/";
  return "https://example.com/";
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function siteFromUrl(value: string, fallback: string) {
  if (!isHttpUrl(value)) return fallback;
  const hostname = new URL(value).hostname;
  if (hostname.endsWith("xiaohongshu.com")) return "小红书";
  if (hostname.endsWith("weixin.qq.com")) return "微信公众号";
  if (hostname.endsWith("douyin.com")) return "抖音";
  if (hostname.endsWith("taobao.com") || hostname.endsWith("tmall.com")) return "淘宝";
  return fallback;
}

function createFingerprintSeed() {
  return `fp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function profileFromIdentity(identity: Identity): ProfilePreset {
  const inferredPlatform = identity.userAgent?.includes("macOS") ? "macOS" : identity.userAgent?.includes("Linux") ? "Linux" : "Windows";
  const platform = identity.platform ?? inferredPlatform;
  const fallback = profilePresets.find((preset) => preset.platform === platform) ?? profilePresets[0];
  return {
    platform,
    screen: identity.screen?.split(" · ")[0] ?? fallback.screen,
    hardwareConcurrency: identity.hardwareConcurrency ?? fallback.hardwareConcurrency,
    gpuPreset: identity.gpuPreset ?? fallback.gpuPreset,
  };
}

function randomProfileAlternative(current: ProfilePreset) {
  const alternatives = profilePresets.filter((preset) => preset.platform !== current.platform || preset.gpuPreset !== current.gpuPreset);
  return alternatives[Math.floor(Math.random() * alternatives.length)] ?? profilePresets[0];
}

function normalizeInteractionPreset(value?: string) {
  return value === "谨慎" || value === "降低速度" ? "降低速度" : "正常速度";
}

function gpuPresets(platform: NonNullable<Identity["platform"]>) {
  if (platform === "macOS") return ["Apple · 集成图形"];
  if (platform === "Linux") return ["Intel · 集成图形", "NVIDIA · 主流桌面"];
  return ["NVIDIA · 主流桌面", "Intel · 集成图形"];
}

function proxyOptions(proxies: ProxyProfile[]) {
  return proxies.map((proxy) => <option value={proxy.name} key={proxy.id} disabled={proxy.state !== "可用"}>{proxy.name}{proxy.state === "可用" ? "" : `（${proxy.state}）`}</option>);
}
