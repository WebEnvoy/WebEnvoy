export type AppView = "work" | "browser" | "library" | "settings";
export type ActionCategory = "observe" | "prepare" | "external" | "sensitive";
export type ExecutionMode = "auto" | "confirm" | "block";
export type ExecutionPolicy = Record<ActionCategory, ExecutionMode>;
export type TaskKind = "collection" | "article" | "download" | "write" | "takeover";
export type TaskState = "success" | "running" | "partial" | "waiting" | "checking" | "unknown" | "failed" | "cancelled" | "not-submitted";
export type ArtifactSet = "xhs-notes" | "shop-products" | "article" | "download-files" | "write-preview";
export type SkillOutputView = "product-comparison";
export type TaskSource = "App" | "CLI" | "MCP" | "API" | "SDK" | "Agent";

export type PrototypePreviewSelection =
  | { kind: "file"; runId: string; tab: "json" | "markdown" | "image" | "media" | "skill-view" }
  | { kind: "note" | "product"; row: string[]; runId: string };

export type ActionExecutionRecord = {
  actionCategory: ActionCategory;
  executionMode: ExecutionMode;
  executionSource: string;
  outcome: "running" | "completed" | "cancelled" | "blocked";
};

export type SubmittedField = {
  key: string;
  label: string;
  value: string;
};

export type PrototypeRun = {
  id: string;
  label: string;
  input: string;
  inputs?: Record<string, string>;
  submittedFields?: SubmittedField[];
  fieldSchemaVersion?: string;
  state: TaskState;
  stateLabel: string;
  summary: string;
  duration?: string;
  endedAt?: string;
  source?: TaskSource;
  attachments?: string[];
  artifactSet?: ArtifactSet;
  artifactState?: "ready" | "pending" | "none";
  artifactTotal?: number;
  artifactCurrent?: number;
  outputView?: SkillOutputView;
  executionMode?: ExecutionMode;
  executionSource?: string;
  actionCategory?: ActionCategory;
  executionRecords?: ActionExecutionRecord[];
  recoveryAttempts?: number;
};

export type ProxyProfile = {
  id: string;
  name: string;
  address: string;
  latency: string;
  state: "可用" | "未检测" | "检测中";
};

export type PrototypeTask = {
  id: string;
  title: string;
  skill: string;
  site: string;
  identity: string;
  identityId: string;
  source: TaskSource;
  state: TaskState;
  stateLabel: string;
  updatedAt: string;
  summary: string;
  kind: TaskKind;
  runs?: PrototypeRun[];
  artifactSet?: ArtifactSet;
  artifactState?: "ready" | "pending" | "none";
  artifactTotal?: number;
  artifactCurrent?: number;
  identityRemoval?: "app-removed" | "environment-deleted";
};

export function articleResultForRun(run: PrototypeRun) {
  const source = run.inputs?.url ?? run.input;
  const issue = source.match(/(?:weekly-|第)(\d+)/)?.[1];
  return {
    source,
    kicker: `产品周报${issue == null ? "" : ` · 第 ${issue} 期`}`,
    title: issue == null ? "我们如何把重复的网站工作变成可复用任务" : `产品周报第 ${issue} 期：把网站工作变成结构化任务`,
    author: "WebEnvoy 产品团队",
    publishedAt: "2026-07-14",
  };
}

export function writeResultForRun(run: PrototypeRun, task: PrototypeTask) {
  return {
    identity: task.identity,
    title: run.inputs?.title ?? run.input,
    body: run.inputs?.body ?? run.input,
    topics: run.inputs?.topics?.split(/\s+/).filter(Boolean) ?? [],
  };
}

export function hasCompatibleOutputView(outputView: SkillOutputView | undefined, artifactSet: ArtifactSet | undefined) {
  return outputView === "product-comparison" && artifactSet === "shop-products";
}

export type Identity = {
  id: string;
  name: string;
  site: string;
  account: string;
  accountAvatar?: string;
  platformId?: string;
  provider: string;
  state: "available" | "running" | "login" | "repair";
  stateLabel: string;
  detail: string;
  region?: string;
  language?: string;
  timezone?: string;
  proxy?: string;
  startPage?: string;
  tags?: string[];
  fingerprint?: string;
  fingerprintSeed?: string;
  platform?: "Windows" | "macOS" | "Linux";
  userAgent?: string;
  screen?: string;
  hardwareConcurrency?: string;
  gpuPreset?: string;
  interactionPreset?: string;
  loginState?: "logged-in" | "login-required" | "not-required" | "unknown";
  sessionState?: "idle" | "running" | "failed";
  controller?: string;
  currentPage?: string;
  lastHealthyAt?: string;
  importSource?: string;
};

export const actionCategories: ActionCategory[] = ["observe", "prepare", "external", "sensitive"];

export const actionCategoryLabels: Record<ActionCategory, string> = {
  observe: "读取和下载",
  prepare: "填写但不提交",
  external: "发布或提交",
  sensitive: "危险行为",
};

export const actionCategoryDetails: Record<ActionCategory, string> = {
  observe: "浏览网页，读取、筛选、整理或下载内容",
  prepare: "填写或生成内容，不点击提交",
  external: "发布、发送或提交，让内容对外生效",
  sensitive: "删除、付款或其他难以撤销的操作",
};

export const executionModeLabels: Record<ExecutionMode, string> = {
  auto: "自动",
  confirm: "确认",
  block: "禁止",
};

export const defaultExecutionPolicy: ExecutionPolicy = {
  observe: "auto",
  prepare: "auto",
  external: "confirm",
  sensitive: "confirm",
};

export type Skill = {
  id: string;
  name: string;
  site: string;
  tags: string[];
  actionCategories: ActionCategory[];
  description: string;
  inputSchemaVersion: string;
  inputFields: SkillInputField[];
  output: string;
  outputView?: SkillOutputView;
  requiresLogin: boolean;
  availability: "available" | "unavailable";
};

export type SkillInputField = {
  key: string;
  label: string;
  placeholder?: string;
  control?: "text" | "url" | "number" | "textarea" | "select";
  options?: string[];
  min?: number;
  max?: number;
  defaultValue?: string;
};

export function snapshotSubmittedFields(skill: Skill, inputs: Record<string, string>): SubmittedField[] {
  return skill.inputFields.map((field) => ({
    key: field.key,
    label: field.label,
    value: inputs[field.key] ?? "",
  }));
}

export function identityCanUseSkill(identity: Identity, skill: Skill) {
  const loginReady = identity.loginState === "logged-in" || (!skill.requiresLogin && identity.loginState === "not-required");
  return identity.site === skill.site
    && (identity.state === "available" || identity.state === "running")
    && identity.sessionState !== "failed"
    && loginReady;
}

export function initialActionCategoryForTask(kind: TaskKind): ActionCategory {
  return kind === "write" ? "prepare" : "observe";
}

export function recommendedExecutionPolicy(skill: Skill): ExecutionPolicy {
  return skill.actionCategories.includes("external")
    ? { observe: "auto", prepare: "auto", external: "confirm", sensitive: "confirm" }
    : { observe: "auto", prepare: "auto", external: "block", sensitive: "block" };
}

export const tasks: PrototypeTask[] = [
  {
    id: "xhs-notes",
    title: "小红书 AI 工具笔记采集",
    skill: "搜索并读取笔记",
    site: "小红书",
    identity: "小红书运营号 A",
    identityId: "xhs-a",
    source: "App",
    state: "success",
    stateLabel: "已完成 · 12 条",
    updatedAt: "今天 14:32",
    summary: "已按关键词“AI 工具”采集 12 条笔记，内容与作者信息可直接查看。",
    kind: "collection",
    artifactSet: "xhs-notes",
    artifactState: "ready",
    artifactTotal: 12,
    runs: [
      { id: "run-01", label: "8 条采集", input: "AI 工具", inputs: { keyword: "AI 工具", quantity: "20", sort: "综合" }, submittedFields: [{ key: "keyword", label: "搜索关键词", value: "AI 工具" }, { key: "quantity", label: "结果数量", value: "20" }, { key: "sort", label: "排序", value: "综合" }], fieldSchemaVersion: "xhs-search/1", state: "success", stateLabel: "已完成 · 8 条", summary: "读取 8 条笔记。", duration: "42 秒", endedAt: "今天 14:28", artifactSet: "xhs-notes", artifactState: "ready", artifactTotal: 8, executionMode: "auto", executionSource: "我的技能默认" },
      { id: "run-02", label: "12 条采集", input: "AI 工具", inputs: { keyword: "AI 工具", quantity: "20", sort: "最新" }, submittedFields: [{ key: "keyword", label: "搜索关键词", value: "AI 工具" }, { key: "quantity", label: "结果数量", value: "20" }, { key: "sort", label: "排序", value: "最新" }], fieldSchemaVersion: "xhs-search/1", state: "success", stateLabel: "已完成 · 12 条", summary: "读取 12 条笔记并更新结构化结果。", duration: "1 分 14 秒", endedAt: "今天 14:32", artifactSet: "xhs-notes", artifactState: "ready", artifactTotal: 12, executionMode: "auto", executionSource: "我的技能默认" },
      { id: "run-03", label: "空结果", input: "不存在的关键词", inputs: { keyword: "不存在的关键词", quantity: "20", sort: "综合" }, submittedFields: [{ key: "keyword", label: "搜索关键词", value: "不存在的关键词" }, { key: "quantity", label: "结果数量", value: "20" }, { key: "sort", label: "排序", value: "综合" }], fieldSchemaVersion: "xhs-search/1", state: "success", stateLabel: "已完成 · 0 条", summary: "没有找到匹配笔记，可修改关键词后再次提交。", duration: "19 秒", endedAt: "今天 14:36", artifactSet: "xhs-notes", artifactState: "ready", artifactTotal: 0, executionMode: "auto", executionSource: "我的技能默认" },
    ],
  },
  {
    id: "wechat-article",
    title: "读取产品周报",
    skill: "公众号文章阅读",
    site: "微信公众号",
    identity: "品牌内容号",
    identityId: "wechat-brand",
    source: "MCP",
    state: "unknown",
    stateLabel: "状态未知",
    updatedAt: "今天 13:18",
    summary: "网络中断后暂时无法确认最新回合状态。",
    kind: "article",
    runs: [{ id: "run-01", label: "文章读取", input: "https://mp.weixin.qq.com/s/webenvoy-weekly-28", inputs: { url: "https://mp.weixin.qq.com/s/webenvoy-weekly-28" }, submittedFields: [{ key: "url", label: "文章链接", value: "https://mp.weixin.qq.com/s/webenvoy-weekly-28" }], fieldSchemaVersion: "wechat-read/1", state: "success", stateLabel: "已完成", summary: "文章正文和图片已读取。", duration: "18 秒", endedAt: "今天 13:18", artifactSet: "article", artifactState: "ready", executionMode: "auto", executionSource: "我的技能默认" }, { id: "run-02", label: "重连检查", input: "https://mp.weixin.qq.com/s/webenvoy-weekly-29", inputs: { url: "https://mp.weixin.qq.com/s/webenvoy-weekly-29" }, submittedFields: [{ key: "url", label: "文章链接", value: "https://mp.weixin.qq.com/s/webenvoy-weekly-29" }], fieldSchemaVersion: "wechat-read/1", state: "unknown", stateLabel: "状态未知", summary: "正在重新读取运行事实；不会重复提交。", artifactSet: "article", artifactState: "none", executionMode: "auto", executionSource: "我的技能默认" }],
    artifactSet: "article",
    artifactState: "none",
  },
  {
    id: "douyin-download",
    title: "下载活动视频素材",
    skill: "公开视频下载",
    site: "抖音",
    identity: "内容研究号",
    identityId: "douyin-lab",
    source: "CLI",
    state: "partial",
    stateLabel: "部分完成 · 3/4",
    updatedAt: "今天 12:46",
    summary: "3 个文件已保存，1 个文件因来源失效未完成，可单独重试。",
    kind: "download",
    runs: [{ id: "run-01", label: "素材下载", input: "活动视频素材链接 · 4 个", inputs: { urls: "https://www.douyin.com/video/73901\nhttps://www.douyin.com/video/73902\nhttps://www.douyin.com/video/73903\nhttps://www.douyin.com/video/73904" }, submittedFields: [{ key: "urls", label: "视频链接", value: "4 个公开视频链接" }], fieldSchemaVersion: "douyin-download/1", state: "partial", stateLabel: "部分完成 · 3/4", summary: "3 个文件已保存，1 个来源失效。", duration: "2 分 18 秒", endedAt: "今天 12:46", artifactSet: "download-files", artifactState: "ready", artifactTotal: 4, artifactCurrent: 3, executionMode: "auto", executionSource: "我的技能默认" }],
    artifactSet: "download-files",
    artifactState: "ready",
  },
  {
    id: "xhs-draft",
    title: "准备新品体验笔记",
    skill: "发布笔记",
    site: "小红书",
    identity: "小红书运营号 A",
    identityId: "xhs-a",
    source: "Agent",
    state: "not-submitted",
    stateLabel: "未提交",
    updatedAt: "今天 11:20",
    summary: "标题、正文和 4 个话题已填入页面并校验，尚未点击发布。",
    kind: "write",
    runs: [{ id: "run-01", label: "草稿准备", input: "新品体验笔记草稿", inputs: { title: "三个让我每天省下两小时的 AI 工具", body: "最近把日常资料整理、内容归档和选题研究重新做了一遍……" }, submittedFields: [{ key: "title", label: "笔记标题", value: "三个让我每天省下两小时的 AI 工具" }, { key: "body", label: "草稿正文", value: "最近把日常资料整理、内容归档和选题研究重新做了一遍……" }], fieldSchemaVersion: "xhs-publish/1", attachments: ["封面.png", "工作流-1.png", "工作流-2.png", "工具清单.png"], state: "not-submitted", stateLabel: "未提交", summary: "页面内容已填写并校验，尚未发布。", duration: "34 秒", endedAt: "今天 11:20", artifactSet: "write-preview", artifactState: "ready", executionMode: "auto", executionSource: "我的技能默认" }],
    artifactSet: "write-preview",
    artifactState: "ready",
  },
  {
    id: "xhs-login",
    title: "读取收藏夹中的竞品笔记",
    skill: "收藏夹浏览",
    site: "小红书",
    identity: "竞品研究号",
    identityId: "research",
    source: "API",
    state: "waiting",
    stateLabel: "需要你完成登录",
    updatedAt: "10 分钟前",
    summary: "账号登录状态已过期。任务已暂停，登录完成并校验成功后会继续。",
    kind: "takeover",
    runs: [{ id: "run-01", label: "收藏夹读取", input: "读取收藏夹：竞品笔记", inputs: { folder: "竞品笔记" }, submittedFields: [{ key: "folder", label: "目标收藏夹", value: "竞品笔记" }], fieldSchemaVersion: "xhs-favorites/1", state: "waiting", stateLabel: "等待人工处理", summary: "登录状态已过期，等待用户恢复。", artifactState: "none", executionMode: "auto", executionSource: "我的技能默认" }],
    artifactState: "none",
  },
  {
    id: "shop-running",
    title: "同步店铺上新商品",
    skill: "商品列表采集",
    site: "淘宝",
    identity: "店铺观察号",
    identityId: "shop-observer",
    source: "SDK",
    state: "running",
    stateLabel: "正在读取 · 36/80",
    updatedAt: "刚刚",
    summary: "正在读取商品标题、价格和库存状态，已产生可用的部分结果。",
    kind: "collection",
    artifactSet: "shop-products",
    artifactState: "ready",
    artifactTotal: 80,
    artifactCurrent: 36,
    runs: [
      { id: "run-01", label: "昨日同步", input: "昨日", inputs: { url: "https://shop.example.com/store/webenvoy", period: "全部" }, submittedFields: [{ key: "url", label: "店铺链接", value: "https://shop.example.com/store/webenvoy" }, { key: "period", label: "时间范围", value: "全部" }], fieldSchemaVersion: "taobao-products/1", state: "success", stateLabel: "已完成 · 64 条", summary: "同步 64 条商品数据。", duration: "3 分 5 秒", endedAt: "昨天 23:58", artifactSet: "shop-products", artifactState: "ready", artifactTotal: 64, artifactCurrent: 64, outputView: "product-comparison", executionMode: "auto", executionSource: "我的技能默认" },
      { id: "run-02", label: "今日同步", input: "今日", inputs: { url: "https://shop.example.com/store/webenvoy", period: "今日" }, submittedFields: [{ key: "url", label: "店铺链接", value: "https://shop.example.com/store/webenvoy" }, { key: "period", label: "时间范围", value: "今日" }], fieldSchemaVersion: "taobao-products/1", state: "running", stateLabel: "正在读取 · 36/80", summary: "正在读取新增商品。", artifactSet: "shop-products", artifactState: "ready", artifactTotal: 80, artifactCurrent: 36, outputView: "product-comparison", executionMode: "auto", executionSource: "我的技能默认" },
    ],
  },
];

export const identities: Identity[] = [
  {
    id: "xhs-a",
    name: "小红书运营号 A",
    site: "小红书",
    account: "WebEnvoy 品牌号",
    accountAvatar: "WE",
    platformId: "xhs_73920418",
    provider: "官方 Chrome",
    state: "running",
    stateLabel: "运行中",
    detail: "实例由任务使用 · 小红书发现页",
    tags: ["内容运营", "品牌号"],
    fingerprint: "Chrome 默认指纹 · WebGL 自动",
    userAgent: "Chrome 126 · macOS",
    screen: "1512 × 982 · 2x",
    loginState: "logged-in",
    sessionState: "running",
    controller: "任务占用",
    currentPage: "小红书发现页",
    lastHealthyAt: "刚刚",
    startPage: "https://www.xiaohongshu.com/explore",
  },
  {
    id: "research",
    name: "竞品研究号",
    site: "小红书",
    account: "产品观察站",
    accountAvatar: "产",
    platformId: "xhs_48172690",
    provider: "官方 Chrome",
    state: "login",
    stateLabel: "需要登录",
    detail: "登录状态已过期 · 18 分钟前确认",
    loginState: "login-required",
    sessionState: "idle",
    controller: "空闲",
    lastHealthyAt: "18 分钟前",
    startPage: "https://www.xiaohongshu.com/explore",
  },
  {
    id: "wechat-brand",
    name: "品牌内容号",
    site: "微信公众号",
    account: "WebEnvoy 产品团队",
    accountAvatar: "WE",
    platformId: "wx_web_2841",
    provider: "官方 Chrome",
    state: "available",
    stateLabel: "可用",
    detail: "空闲 · 今天 13:18 使用",
    loginState: "logged-in",
    sessionState: "idle",
    controller: "空闲",
    lastHealthyAt: "今天 13:18",
    startPage: "https://mp.weixin.qq.com/",
  },
  {
    id: "douyin-lab",
    name: "内容研究号",
    site: "抖音",
    account: "内容研究所",
    accountAvatar: "研",
    platformId: "douyin_739104",
    provider: "CloakBrowser",
    state: "repair",
    stateLabel: "需要修复",
    detail: "CloakBrowser 未安装",
    tags: ["素材研究", "抖音"],
    fingerprint: "独立种子 · WebGL/Canvas 隔离",
    userAgent: "Chrome 126 · macOS",
    screen: "1440 × 900 · 2x",
    loginState: "unknown",
    sessionState: "failed",
    controller: "空闲",
    lastHealthyAt: "尚未验证",
    startPage: "https://www.douyin.com/",
  },
];

export const skills: Skill[] = [
  {
    id: "xhs-search",
    name: "搜索并读取笔记",
    site: "小红书",
    tags: ["数据采集", "内容浏览"],
    actionCategories: ["observe"],
    description: "按关键词搜索笔记，读取标题、作者、互动数据和正文。",
    inputSchemaVersion: "xhs-search/1",
    inputFields: [
      { key: "keyword", label: "搜索关键词", placeholder: "例如：AI 工具" },
      { key: "quantity", label: "结果数量", control: "select", options: ["20", "50", "100"], defaultValue: "20" },
      { key: "sort", label: "排序", control: "select", options: ["综合", "最新", "最多点赞"], defaultValue: "综合" },
    ],
    output: "笔记列表、内容详情、作者与互动数据",
    requiresLogin: false,
    availability: "available",
  },
  {
    id: "xhs-publish",
    name: "发布笔记",
    site: "小红书",
    tags: ["内容发布"],
    actionCategories: ["observe", "prepare", "external"],
    description: "填写标题、正文、图片与话题，并按当前执行方式决定是否提交。",
    inputSchemaVersion: "xhs-publish/1",
    inputFields: [
      { key: "title", label: "笔记标题", placeholder: "输入本次发布的标题" },
      { key: "body", label: "草稿正文", placeholder: "输入要填写到页面的正文", control: "textarea" },
    ],
    output: "提交状态与页面结果",
    requiresLogin: true,
    availability: "available",
  },
  {
    id: "xhs-favorites",
    name: "收藏夹浏览",
    site: "小红书",
    tags: ["内容浏览", "数据采集"],
    actionCategories: ["observe"],
    description: "读取指定收藏夹中的笔记，并保留内容、作者与来源信息。",
    inputSchemaVersion: "xhs-favorites/1",
    inputFields: [{ key: "folder", label: "目标收藏夹", placeholder: "输入收藏夹名称或网址" }],
    output: "收藏笔记列表、内容详情与来源信息",
    requiresLogin: true,
    availability: "available",
  },
  {
    id: "wechat-read",
    name: "公众号文章阅读",
    site: "微信公众号",
    tags: ["内容浏览", "数据采集"],
    actionCategories: ["observe"],
    description: "读取指定公众号文章，保留正文结构、图片与来源信息。",
    inputSchemaVersion: "wechat-read/1",
    inputFields: [{ key: "url", label: "文章链接", placeholder: "粘贴 mp.weixin.qq.com 文章链接", control: "url" }],
    output: "可阅读文章、作者、发布时间与图片",
    requiresLogin: false,
    availability: "available",
  },
  {
    id: "douyin-download",
    name: "公开视频下载",
    site: "抖音",
    tags: ["内容下载"],
    actionCategories: ["observe"],
    description: "保存指定公开视频及其基础描述，逐个显示文件结果。",
    inputSchemaVersion: "douyin-download/1",
    inputFields: [{ key: "urls", label: "视频链接", placeholder: "每行粘贴一个公开视频链接", control: "textarea" }],
    output: "视频文件、文件名、大小与保存位置",
    requiresLogin: false,
    availability: "available",
  },
  {
    id: "taobao-products",
    name: "商品列表采集",
    site: "淘宝",
    tags: ["数据采集"],
    actionCategories: ["observe"],
    description: "读取店铺商品列表中的标题、价格、库存和详情链接。",
    inputSchemaVersion: "taobao-products/1",
    inputFields: [
      { key: "url", label: "店铺链接", placeholder: "粘贴目标店铺首页链接", control: "url" },
      { key: "period", label: "时间范围", control: "select", options: ["今日", "最近 7 天", "全部"], defaultValue: "今日" },
    ],
    output: "结构化商品列表",
    outputView: "product-comparison",
    requiresLogin: false,
    availability: "available",
  },
  {
    id: "boss-jobs",
    name: "职位搜索与详情读取",
    site: "BOSS 直聘",
    tags: ["数据采集", "内容浏览"],
    actionCategories: ["observe"],
    description: "目标站点当前访问条件不稳定，暂不允许创建生产任务。",
    inputSchemaVersion: "boss-jobs/1",
    inputFields: [{ key: "keyword", label: "职位关键词", placeholder: "暂不可用" }],
    output: "职位列表与详情",
    requiresLogin: false,
    availability: "unavailable",
  },
];

export const resultRows = [
  ["让 AI 自动整理资料的 5 个方法", "一只产品汪", "2,481", "今天 14:28"],
  ["我用了一周的本地 AI 工作台", "数字生活家", "1,906", "今天 14:26"],
  ["AI 工具怎么选：先看这三个场景", "小北效率论", "1,284", "今天 14:21"],
  ["从资料收集到内容发布的自动化", "运营手记", "986", "今天 14:16"],
  ["普通人也能搭好的 AI 信息流", "小林同学", "735", "今天 14:12"],
  ["把网页资料变成结构化数据", "效率研究所", "682", "今天 14:08"],
  ["内容团队的 AI 协作清单", "产品手记", "641", "今天 14:02"],
  ["从搜索到交付：自动化实录", "阿凯聊工具", "598", "今天 13:57"],
  ["我如何整理一百篇行业笔记", "数据小站", "544", "今天 13:51"],
  ["AI 阅读工作流的三个误区", "小周效率论", "509", "今天 13:45"],
  ["适合运营团队的本地工具", "运营新知", "476", "今天 13:39"],
  ["信息采集任务如何验收", "交付笔记", "421", "今天 13:32"],
];

export const productRows = [
  ["便携补光灯", "¥129", "有货", "今天 14:31"],
  ["无线领夹麦克风", "¥239", "有货", "今天 14:29"],
  ["桌面直播支架", "¥89", "补货中", "今天 14:27"],
  ["USB 采集卡", "¥169", "有货", "今天 14:25"],
  ["柔光箱套装", "¥199", "有货", "今天 14:22"],
  ["提词器支架", "¥149", "有货", "今天 14:19"],
  ["桌面麦克风", "¥299", "补货中", "今天 14:16"],
  ["环形补光灯", "¥159", "有货", "今天 14:12"],
  ["直播背景布", "¥79", "有货", "今天 14:08"],
  ["手机监看屏", "¥349", "有货", "今天 14:05"],
  ["便携三脚架", "¥119", "有货", "今天 14:01"],
  ["桌面理线器", "¥39", "补货中", "今天 13:58"],
];
