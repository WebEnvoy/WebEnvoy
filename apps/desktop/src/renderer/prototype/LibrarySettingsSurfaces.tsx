import {
  ArrowRight,
  BriefcaseBusiness,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Download,
  Images,
  Languages,
  Library,
  LoaderCircle,
  MessageCircle,
  Music2,
  Network,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  ShoppingBag,
  Stethoscope,
  Trash2,
  X,
} from "lucide-react";
import { useMemo, useState, type Dispatch, type SetStateAction } from "react";

import {
  actionCategories,
  actionCategoryDetails,
  actionCategoryLabels,
  defaultExecutionPolicy,
  executionModeLabels,
  skills,
  type ActionCategory,
  type ExecutionMode,
  type ExecutionPolicy,
  type Identity,
  type ProxyProfile,
  type Skill,
} from "./prototypeData";

const tags = ["数据采集", "内容发布", "内容下载", "内容浏览"];
type LibraryMode = "catalog" | "detail" | "create";
type SettingsSection = "general" | "authorization" | "proxies" | "diagnostics";

export function LibrarySurface({ disabledSkillIds, mode, siteFilter, selectedSkill, skillPolicies, onModeChange, onSelectSkill, onSkillEnabledChange, onSkillPolicyChange, onUse }: {
  disabledSkillIds: string[];
  mode: LibraryMode;
  siteFilter: string;
  selectedSkill: Skill;
  skillPolicies: Record<string, ExecutionPolicy>;
  onModeChange: (mode: LibraryMode) => void;
  onSelectSkill: (skillId: string) => void;
  onSkillEnabledChange: (skillId: string, enabled: boolean) => void;
  onSkillPolicyChange: (skillId: string, policy: ExecutionPolicy) => void;
  onUse: (skillId: string) => void;
}) {
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const discovery = siteFilter === "全部";
  const filteredSkills = useMemo(() => skills.filter((skill) => {
    const matchesTag = selectedTags.every((tag) => skill.tags.includes(tag));
    const matchesSite = discovery || skill.site === siteFilter;
    const searchable = `${skill.site}${skill.name}${skill.description}`.toLowerCase();
    return matchesSite && matchesTag && (!discovery || searchable.includes(query.toLowerCase()));
  }), [discovery, query, selectedTags, siteFilter]);

  if (mode === "detail") return <SkillDetail enabled={!disabledSkillIds.includes(selectedSkill.id)} policy={skillPolicies[selectedSkill.id]} skill={selectedSkill} onBack={() => onModeChange("catalog")} onPolicyChange={(policy) => onSkillPolicyChange(selectedSkill.id, policy)} onToggleEnabled={() => onSkillEnabledChange(selectedSkill.id, disabledSkillIds.includes(selectedSkill.id))} onUse={onUse} />;
  if (mode === "create") return <CreateSkillSurface onDone={() => onModeChange("catalog")} />;

  const sites = Array.from(new Set(filteredSkills.map((skill) => skill.site)));
  return (
    <div className="prototype-page library-page">
      {discovery ? (
        <header className="prototype-page-heading"><div><div className="prototype-eyebrow">站点技能</div><h1>发现站点技能</h1><p>浏览所有可用站点能力，或按站点和业务类型缩小范围。</p></div></header>
      ) : (
        <header className="site-skill-banner"><span className="site-banner-mark"><SiteGlyph site={siteFilter} size={26} /></span><div><span>站点技能</span><h1>{siteFilter}</h1></div></header>
      )}
      <div className={`library-toolbar ${discovery ? "discovery-toolbar" : "site-toolbar"}`}>
        {discovery ? <label className="prototype-search"><Search size={15} /><input value={query} placeholder="搜索站点或技能" onChange={(event) => setQuery(event.target.value)} /></label> : null}
        <div className="tag-filter" role="group" aria-label="业务场景筛选"><button className={selectedTags.length === 0 ? "selected" : ""} type="button" aria-pressed={selectedTags.length === 0} onClick={() => setSelectedTags([])}>全部</button>{tags.map((item) => <button className={selectedTags.includes(item) ? "selected" : ""} type="button" aria-pressed={selectedTags.includes(item)} key={item} onClick={() => setSelectedTags((current) => current.includes(item) ? current.filter((tag) => tag !== item) : [...current, item])}>{item}</button>)}</div>
      </div>
      {sites.length === 0 ? <div className="prototype-empty"><Search size={24} /><h2>没有匹配的站点技能</h2><p>{discovery ? `“${query}” · ${selectedTags.join(" + ") || "全部"}` : `${siteFilter} · ${selectedTags.join(" + ") || "全部"}`}</p><button className="prototype-button" type="button" onClick={() => { setSelectedTags([]); setQuery(""); }}>清除筛选</button></div> : null}
      <div className="skill-site-groups">{sites.map((site) => <SkillSiteGroup disabledSkillIds={disabledSkillIds} discovery={discovery} key={site} site={site} siteSkills={filteredSkills.filter((skill) => skill.site === site)} onModeChange={onModeChange} onSelectSkill={onSelectSkill} onUse={onUse} />)}</div>
    </div>
  );
}

function SkillSiteGroup({ disabledSkillIds, discovery, site, siteSkills, onModeChange, onSelectSkill, onUse }: { disabledSkillIds: string[]; discovery: boolean; site: string; siteSkills: Skill[]; onModeChange: (mode: LibraryMode) => void; onSelectSkill: (skillId: string) => void; onUse: (skillId: string) => void }) {
  const types = Array.from(new Set(siteSkills.map((skill) => skill.tags[0] ?? "其他")));
  return (
    <section className="skill-site-group">
      {discovery ? <div className="skill-site-heading"><span className="site-mark"><SiteGlyph site={site} size={16} /></span><h2>{site}</h2></div> : null}
      {types.map((type) => <div className="skill-type-block" key={type}><h3>{type}</h3><div className="skill-list">{siteSkills.filter((skill) => (skill.tags[0] ?? "其他") === type).map((skill) => <SkillRow enabled={!disabledSkillIds.includes(skill.id)} key={skill.id} skill={skill} onOpen={() => { onSelectSkill(skill.id); onModeChange("detail"); }} onUse={() => onUse(skill.id)} />)}</div></div>)}
    </section>
  );
}

function SkillRow({ enabled, skill, onOpen, onUse }: { enabled: boolean; skill: Skill; onOpen: () => void; onUse: () => void }) {
  return (
    <div className={`skill-row ${skill.availability}`}>
      <button className="skill-row-main" type="button" onClick={onOpen}><span className="skill-icon"><SiteGlyph site={skill.site} size={17} /></span><span><strong>{skill.name}</strong><small>{skill.description}</small><span className="skill-tags">{skill.tags.map((tag) => <em key={tag}>{tag}</em>)}</span></span></button>
      <div className="skill-row-actions">{skill.availability === "available" ? <><span className={`availability ${enabled ? "" : "unavailable"}`}>{enabled ? <span /> : <CircleAlert size={13} />}{enabled ? "可用" : "已停用"}</span><button className="prototype-button primary compact" type="button" disabled={!enabled} onClick={onUse}>去使用</button></> : <><span className="availability unavailable"><CircleAlert size={13} />已延期</span><button className="prototype-button compact" type="button" onClick={onOpen}>查看说明</button></>}</div>
    </div>
  );
}

function SkillDetail({ enabled, policy, skill, onBack, onPolicyChange, onToggleEnabled, onUse }: { enabled: boolean; policy?: ExecutionPolicy; skill: Skill; onBack: () => void; onPolicyChange: (policy: ExecutionPolicy) => void; onToggleEnabled: () => void; onUse: (skillId: string) => void }) {
  const userPolicy = policy ?? defaultExecutionPolicy;
  const [maintenanceStatus, setMaintenanceStatus] = useState("");
  return (
    <div className="prototype-page skill-detail-page">
      <button className="inline-link back-link" type="button" onClick={onBack}>返回站点技能</button>
      <header className="prototype-page-heading skill-detail-heading"><div className="skill-detail-title"><span className="skill-icon large"><SiteGlyph site={skill.site} size={22} /></span><div><div className="prototype-eyebrow">{skill.site}</div><h1>{skill.name}</h1><div className="skill-tags">{skill.tags.map((tag) => <em key={tag}>{tag}</em>)}</div></div></div>{skill.availability === "available" ? <button className="prototype-button primary" type="button" disabled={!enabled} onClick={() => onUse(skill.id)}>{enabled ? "去使用" : "已停用"} <ArrowRight size={14} /></button> : <button className="prototype-button" type="button" disabled>当前不可用</button>}</header>
      {skill.availability === "unavailable" ? <section className="prototype-callout action-needed"><CircleAlert size={18} /><div><strong>目标站点当前访问受限</strong><p>本技能保留为延期项，当前不会创建生产任务。</p></div></section> : null}
      <div className="skill-detail-grid"><section className="prototype-section"><h2>这个技能能做什么</h2><p className="lead-copy">{skill.description}</p><dl className="prototype-detail-list"><div><dt>需要提供</dt><dd>{skill.inputFields.map((field) => field.label).join("、")}</dd></div><div><dt>返回结果</dt><dd>{skill.output}</dd></div><div><dt>结果视图</dt><dd>{skill.outputView === "product-comparison" ? "商品对比 · 同时保留结构化数据" : "App 标准视图"}</dd></div><div><dt>兼容身份</dt><dd>{skill.site} · {skill.requiresLogin ? "需要已登录账号" : "登录账号或无需登录身份"}</dd></div></dl></section><section className="prototype-section"><h2>创建任务时的输入</h2>{skill.inputFields.map((field) => <div className="sample-contract-field" key={field.key}><label>{field.label}</label><div>{field.placeholder ?? field.options?.join(" / ")}</div></div>)}<p className="muted-copy">输入字段、选项与校验由技能合同定义。</p></section></div>
      {skill.availability === "available" ? <section className="prototype-section skill-execution-section"><div className="prototype-section-title"><div><h2>我的执行设置</h2><p>修改后作为这个技能的默认设置。</p></div></div><ExecutionPolicyRows categories={skill.actionCategories} policy={userPolicy} onChange={(category, mode) => onPolicyChange({ ...userPolicy, [category]: mode })} /><p className="declared-action-copy">技能声明：{skill.actionCategories.map((category) => actionCategoryLabels[category]).join("、")}；实际目标不匹配或无法分类时停止执行。</p></section> : <section className="prototype-section skill-execution-section"><div className="prototype-section-title"><div><h2>我的执行设置</h2><p>当前技能尚未安装或不可用，不能创建本地设置。</p></div></div></section>}
      <details className="prototype-disclosure"><summary><ChevronDown size={15} />版本与维护<span>{skill.availability === "available" ? `当前版本 1.4.2 · ${enabled ? "已启用" : "已停用"}` : "尚未安装 · 当前不可用"}</span></summary><div className="diagnostic-detail"><p>{maintenanceStatus || (skill.availability === "available" ? enabled ? "当前版本与动作声明已通过检查。" : "技能已停用；已有结果仍可查看。" : "目标站点受限，修复前不能创建任务。")}</p><div className="section-actions"><button className="prototype-button" type="button" onClick={() => setMaintenanceStatus(skill.availability === "available" ? "发现 1.5.0：动作声明有变化，安装前需要采用或修订新增动作的推荐方式" : "修复失败：目标站点仍不可访问")}>{skill.availability === "available" ? "检查更新" : "重新检查"}</button><button className="prototype-button" type="button" onClick={() => { if (skill.availability === "available") onToggleEnabled(); setMaintenanceStatus(skill.availability === "available" ? enabled ? "技能已停用；已有结果仍可查看" : "技能已重新启用，可以创建任务" : "仍不可用；已保留诊断信息"); }}>{skill.availability === "available" ? enabled ? "停用技能" : "重新启用" : "保留诊断"}</button></div></div></details>
    </div>
  );
}

function CreateSkillSurface({ onDone }: { onDone: () => void }) {
  const [site, setSite] = useState("小红书");
  const [source, setSource] = useState("");
  const [policy, setPolicy] = useState<ExecutionPolicy>({ ...defaultExecutionPolicy });
  return <div className="prototype-page create-skill-page"><header className="prototype-page-heading"><div><div className="prototype-eyebrow">站点技能</div><h1>新增站点技能</h1><p>从本机目录或软件包地址导入站点技能。</p></div></header><form className="prototype-form" onSubmit={(event) => { event.preventDefault(); onDone(); }}><fieldset><legend>技能来源</legend><label>目标站点<select value={site} onChange={(event) => setSite(event.target.value)}><option>小红书</option><option>微信公众号</option><option>抖音</option><option>淘宝</option></select></label><label>本机目录或软件包地址<input required value={source} placeholder="选择目录或输入软件包地址" onChange={(event) => setSource(event.target.value)} /></label></fieldset>{source.trim() !== "" ? <fieldset><legend>安装时的执行方式</legend><p className="muted-copy">已载入技能推荐配置，可直接采用或修订后安装。</p><ExecutionPolicyRows policy={policy} onChange={(category, mode) => setPolicy((current) => ({ ...current, [category]: mode }))} /></fieldset> : null}<div className="form-footer"><span>导入后会检查业务动作、目标范围和输入合同。</span><button className="prototype-button primary" type="submit" disabled={source.trim() === ""}><Plus size={14} />添加技能</button></div></form></div>;
}

export function SettingsSurface({ globalPolicy, identities, proxies, section, onGlobalPolicyChange, onProxiesChange }: { globalPolicy: ExecutionPolicy; identities: Identity[]; proxies: ProxyProfile[]; section: SettingsSection; onGlobalPolicyChange: (policy: ExecutionPolicy) => void; onProxiesChange: Dispatch<SetStateAction<ProxyProfile[]>> }) {
  if (section === "general") return <GeneralSettings />;
  if (section === "proxies") return <ProxySettings identities={identities} proxies={proxies} onProxiesChange={onProxiesChange} />;
  if (section === "diagnostics") return <DiagnosticsSettings />;
  return <GlobalExecutionSettings policy={globalPolicy} onPolicyChange={onGlobalPolicyChange} />;
}

function GeneralSettings() {
  const [language, setLanguage] = useState("简体中文");
  return <div className="prototype-page settings-page"><header className="prototype-page-heading"><div><div className="prototype-eyebrow">设置</div><h1>通用</h1><p>管理 App 的显示语言与本机体验。</p></div></header><section className="settings-main settings-single-column"><div className="settings-section"><div className="settings-section-heading"><Languages size={18} /><div><h2>语言</h2><p>更改 App 导航、按钮和状态文本使用的语言。</p></div></div><label className="settings-control">界面语言<select value={language} onChange={(event) => setLanguage(event.target.value)}><option>简体中文</option><option>English</option></select></label></div></section></div>;
}

function ProxySettings({ identities, proxies, onProxiesChange }: { identities: Identity[]; proxies: ProxyProfile[]; onProxiesChange: Dispatch<SetStateAction<ProxyProfile[]>> }) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");

  function detectProxy(proxyId: string) {
    onProxiesChange((current) => current.map((proxy) => proxy.id === proxyId ? { ...proxy, state: "检测中" } : proxy));
    window.setTimeout(() => {
      onProxiesChange((current) => current.map((proxy) => proxy.id === proxyId ? { ...proxy, latency: "连接正常 · 68 ms", state: "可用" } : proxy));
    }, 650);
  }

  return <div className="prototype-page settings-page"><header className="prototype-page-heading"><div><div className="prototype-eyebrow">设置</div><h1>代理管理</h1><p>集中新增、检测和删除可供账号身份复用的代理。</p></div></header><section className="settings-main settings-single-column"><div className="proxy-list">{proxies.map((proxy) => { const inUse = identities.some((identity) => identity.proxy === proxy.name); return <div className="proxy-row" key={proxy.id}><span className="service-icon"><Network size={17} /></span><div><strong>{proxy.name}</strong><small>{proxy.address} · {proxy.latency}{inUse ? " · 正被账号身份使用" : ""}</small></div><span className={`prototype-state-chip ${proxy.state === "可用" ? "available" : "login"}`}>{proxy.state === "检测中" ? <LoaderCircle size={13} /> : proxy.state === "可用" ? <CircleCheck size={13} /> : <CircleAlert size={13} />}{proxy.state}</span><button className="icon-plain-button" type="button" aria-label={`检测 ${proxy.name}`} title="检测" onClick={() => detectProxy(proxy.id)}><RefreshCw size={14} /></button><button className="icon-plain-button" type="button" aria-label={`删除 ${proxy.name}`} title={inUse ? "账号身份正在使用此代理" : "删除"} disabled={inUse} onClick={() => onProxiesChange((current) => current.filter((item) => item.id !== proxy.id))}><Trash2 size={14} /></button></div>; })}</div><form className="proxy-add-form" onSubmit={(event) => { event.preventDefault(); if (name.trim() === "" || address.trim() === "") return; onProxiesChange((current) => [...current, { id: `proxy-${Date.now()}`, name: name.trim(), address: address.trim(), latency: "尚未检测", state: "未检测" }]); setName(""); setAddress(""); }}><label>代理名称<input value={name} placeholder="例如：美国西海岸线路" onChange={(event) => setName(event.target.value)} /></label><label>地址<input value={address} placeholder="host:port" onChange={(event) => setAddress(event.target.value)} /></label><button className="prototype-button primary" type="submit" disabled={name.trim() === "" || address.trim() === ""}><Plus size={14} />新增代理</button></form></section></div>;
}

function GlobalExecutionSettings({ policy, onPolicyChange }: { policy: ExecutionPolicy; onPolicyChange: (policy: ExecutionPolicy) => void }) {
  return <div className="prototype-page settings-page"><header className="prototype-page-heading"><div><div className="prototype-eyebrow">设置</div><h1>全局执行方式</h1><p>为四类业务动作设置所有入口共用的默认执行方式。</p></div></header><section className="settings-main settings-single-column"><div className="settings-section"><div className="settings-section-heading"><ShieldCheck size={18} /><div><h2>全局默认</h2><p>分别选择自动、确认或禁止；具体页面只展示与当前工作有关的结果。</p></div></div><ExecutionPolicyRows policy={policy} onChange={(category, mode) => onPolicyChange({ ...policy, [category]: mode })} /></div><div className="settings-section"><div className="settings-section-heading"><CircleCheck size={18} /><div><h2>适用入口</h2><p>同一用户配置用于 App、CLI、MCP、API、SDK 和 Agent。</p></div></div><div className="settings-entry-list">{["App", "CLI", "MCP", "API", "SDK", "Agent"].map((entry) => <span key={entry}><CircleCheck size={14} />{entry}</span>)}</div></div></section></div>;
}

function ExecutionPolicyRows({ categories = actionCategories, policy, onChange }: { categories?: ActionCategory[]; policy: ExecutionPolicy; onChange: (category: ActionCategory, mode: ExecutionMode) => void }) {
  const [showRiskCopy, setShowRiskCopy] = useState(true);
  const riskyAuto = categories.includes("sensitive") && policy.sensitive === "auto";
  return <div className="execution-policy-editor">{categories.map((category) => <div className="execution-policy-row" key={category}><span className="execution-policy-copy">{category === "sensitive" && policy[category] === "auto" ? <CircleAlert className="danger" size={15} /> : <ShieldCheck size={15} />}<span><strong>{actionCategoryLabels[category]}</strong><small>{actionCategoryDetails[category]}</small></span></span><div className="execution-mode-options" role="group" aria-label={`${actionCategoryLabels[category]}执行方式`}>{(["auto", "confirm", "block"] as ExecutionMode[]).map((mode) => <button aria-pressed={policy[category] === mode} className={policy[category] === mode ? "selected" : ""} type="button" key={mode} onClick={() => onChange(category, mode)}>{executionModeLabels[mode]}</button>)}</div></div>)}{riskyAuto && showRiskCopy ? <div className="execution-risk-notice"><CircleAlert size={16} /><span><strong>危险行为将自动执行</strong><small>系统会按你的选择执行，并在运行记录中保留当时的执行方式和来源。</small></span><button type="button" aria-label="关闭风险说明" title="关闭说明" onClick={() => setShowRiskCopy(false)}><X size={13} /></button></div> : null}</div>;
}

function DiagnosticsSettings() {
  const [checked, setChecked] = useState(false);
  const [exported, setExported] = useState(false);
  return <div className="prototype-page settings-page"><header className="prototype-page-heading"><div><div className="prototype-eyebrow">设置</div><h1>诊断</h1><p>在任务或环境出现问题时检查本机组件并导出诊断信息。</p></div></header><section className="diagnostics-summary"><span className="diagnostics-icon"><Stethoscope size={20} /></span><div><h2>所有组件运行正常</h2><p>{checked ? "刚刚重新检查完成" : "最近检查：刚刚"} · 任务、账号环境、站点技能和浏览器均可用</p></div><button className="prototype-button" type="button" onClick={() => setChecked(true)}><RefreshCw size={14} />{checked ? "检查完成" : "重新检查"}</button></section><section className="prototype-section diagnostic-actions"><div><h2>诊断包</h2><p>{exported ? "诊断包已保存到下载目录。" : "导出运行日志和组件状态。"}</p></div><button className="prototype-button" type="button" onClick={() => setExported(true)}><Download size={14} />{exported ? "已导出" : "导出诊断包"}</button></section></div>;
}

function SiteGlyph({ site, size }: { site: string; size: number }) {
  if (site === "小红书") return <Images size={size} />;
  if (site === "微信公众号") return <MessageCircle size={size} />;
  if (site === "抖音") return <Music2 size={size} />;
  if (site === "淘宝") return <ShoppingBag size={size} />;
  if (site === "BOSS 直聘") return <BriefcaseBusiness size={size} />;
  return <Library size={size} />;
}
