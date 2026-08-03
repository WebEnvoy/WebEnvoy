import type { OwnerSource } from "./taskThreadFixtures";

export type IdentityStatus = "ready" | "needs-auth" | "warning" | "blocked" | "unknown";
export type BrowserProviderState = "available" | "missing" | "restricted";
export type BrowserSessionState = "idle" | "running" | "takeover" | "stopped" | "failed";
export type BrowserController = "手动浏览" | "用户接管" | "智能体直接浏览" | "Core 任务运行" | "空闲";

export type BrowserTargetProjection = {
  id: "xiaohongshu" | "boss";
  label: "小红书" | "BOSS";
  defaultUrl: string;
  defaultTitle: string;
  readiness: string;
};

export type BrowserProviderProjection = {
  name: "CloakBrowser" | "官方 Chrome";
  role: "推荐主力" | "受限后备";
  state: BrowserProviderState;
  statusLabel: string;
  summary: string;
  installHint?: string;
};

export type BrowserSessionProjection = {
  provider: BrowserProviderProjection["name"];
  state: BrowserSessionState;
  statusLabel: string;
  controller: BrowserController;
  browserSessionRef: string;
  viewerRef: string;
  currentUrl: string;
  title: string;
  startedAt: string;
  message: string;
};

export type IdentityTaskEntryProjection = {
  id: string;
  label: string;
  taskId: string;
  inputSummary: string;
  readiness: string;
  source: OwnerSource;
};

export type IdentityEnvironmentProjection = {
  id: string;
  name: string;
  siteName: "小红书" | "BOSS";
  siteId: "xiaohongshu" | "boss";
  origin: string;
  accountLabel: string;
  source: OwnerSource;
  fetchedAt: string;
  identityEnvironmentRef: string;
  executionIdentityRef: string;
  profileRef: string;
  admissionFacts?: {
    providerId: "cloakbrowser" | "chrome_official" | null;
    providerRole: "primary" | "restricted_fallback" | null;
    authenticationProvenance: string | null;
    loginState: string;
    manualAuthenticationState: string;
    recoveryRequired: boolean;
    browserStorageState: string;
    warningReasonCodes: string[];
  };
  provider: {
    selected: "CloakBrowser" | "官方 Chrome" | "未可用";
    role: "默认主力" | "受限后备" | "不可启动";
    state: IdentityStatus;
    reason: string;
  };
  login: {
    state: "已登录" | "未登录" | "已过期" | "需要人工认证" | "未知";
    recoveryRequired: boolean;
    manualAuthenticationState: "无需认证" | "需要认证" | "认证中" | "已完成" | "认证失败";
    recoveryActions: string[];
    reason: string;
  };
  environment: {
    proxy: string;
    proxyRef: string | null;
    geoipMode: "proxy" | "system" | "disabled" | null;
    region: string;
    language: string;
    timezone: string;
    browser: string;
    userAgent: string;
    viewport: string;
    hardwareConcurrency: number | null;
    deviceMemoryGb: number | null;
    gpuProfile: string | null;
    interactionPreset: "default" | "humanized" | null;
    fingerprintStrategy: "provider_default" | "stable" | null;
    fingerprint: string;
  };
  storage: {
    profileStorage: "存在" | "缺失" | "未知";
    cookies: "存在" | "缺失" | "过期" | "未知";
    credentialRef: "已绑定本机引用" | "未绑定" | "未知";
  };
  readiness: {
    state: IdentityStatus;
    label: string;
    reasons: string[];
  };
  siteBindings: string[];
  browser: {
    providers: BrowserProviderProjection[];
    defaultProvider: BrowserProviderProjection["name"];
    targets: BrowserTargetProjection[];
    session: BrowserSessionProjection;
    boundary: string;
  };
  taskEntries: IdentityTaskEntryProjection[];
};

export const manualBrowserTargets: BrowserTargetProjection[] = [
  {
    id: "xiaohongshu",
    label: "小红书",
    defaultUrl: "https://www.xiaohongshu.com/explore",
    defaultTitle: "小红书 - 发现",
    readiness: "默认打开首页/发现页；不自动登录、不执行站点技能。",
  },
  {
    id: "boss",
    label: "BOSS",
    defaultUrl: "https://www.zhipin.com/web/geek/job",
    defaultTitle: "BOSS直聘 - 职位",
    readiness: "默认打开职位入口；登录恢复仍由 Harbor 现场处理。",
  },
];

const primaryProvider: BrowserProviderProjection = {
  name: "CloakBrowser",
  role: "推荐主力",
  state: "available",
  statusLabel: "可用",
  summary: "完整身份环境优先使用 CloakBrowser；Harbor 拥有检测、启动和能力矩阵事实。",
};

const restrictedChromeProvider: BrowserProviderProjection = {
  name: "官方 Chrome",
  role: "受限后备",
  state: "restricted",
  statusLabel: "受限",
  summary: "仅用于 fallback/dev/manual，不声明完整身份一致性或原生指纹能力。",
};

const missingCloakProvider: BrowserProviderProjection = {
  name: "CloakBrowser",
  role: "推荐主力",
  state: "missing",
  statusLabel: "未安装",
  summary: "缺少 CloakBrowser 会影响身份一致性和真实任务运行。",
  installHint: "按 Harbor 下载引导安装 CloakBrowser 后刷新状态。",
};

export const identityEnvironmentFixtures: IdentityEnvironmentProjection[] = [
  {
    id: "identity-xhs-ops-a",
    name: "小红书运营号 A",
    siteName: "小红书",
    siteId: "xiaohongshu",
    origin: "https://www.xiaohongshu.com",
    accountLabel: "运营号 A",
    source: "Harbor fixture",
    fetchedAt: "2026-07-06T08:46:00Z",
    identityEnvironmentRef: "harbor://identity-environment/xhs-ops-a",
    executionIdentityRef: "harbor://execution-identity/xhs-ops-a",
    profileRef: "harbor://profile/xhs-ops-a",
    provider: {
      selected: "CloakBrowser",
      role: "默认主力",
      state: "ready",
      reason: "Harbor 默认选择 CloakBrowser；官方 Chrome 仅作 fallback/dev/manual。",
    },
    login: {
      state: "已登录",
      recoveryRequired: false,
      manualAuthenticationState: "无需认证",
      recoveryActions: [],
      reason: "Harbor public summary 显示登录态可用。",
    },
    environment: {
      proxy: "上海住宅代理 · proxy_ref 已配置",
      proxyRef: "proxy_ref_fixture_xhs",
      geoipMode: "proxy",
      region: "CN-SH",
      language: "zh-CN",
      timezone: "Asia/Shanghai",
      browser: "CloakBrowser 145",
      userAgent: "Chrome family / desktop",
      viewport: "1440 x 900",
      hardwareConcurrency: 8,
      deviceMemoryGb: 8,
      gpuProfile: "desktop-default",
      interactionPreset: "default",
      fingerprintStrategy: "provider_default",
      fingerprint: "provider_claim: cloak-native-fingerprint / validation required",
    },
    storage: {
      profileStorage: "存在",
      cookies: "存在",
      credentialRef: "已绑定本机引用",
    },
    readiness: {
      state: "ready",
      label: "可用于只读任务",
      reasons: ["provider、代理、地区、语言、时区和登录态均有 Harbor 摘要。"],
    },
    siteBindings: ["小红书搜索和笔记读取", "小红书发布草稿写前预览"],
    browser: {
      providers: [primaryProvider, restrictedChromeProvider],
      defaultProvider: "CloakBrowser",
      targets: manualBrowserTargets,
      session: {
        provider: "CloakBrowser",
        state: "running",
        statusLabel: "已启动",
        controller: "手动浏览",
        browserSessionRef: "browser-session://cloak/xhs-ops-a/manual-014",
        viewerRef: "viewer://harbor/cloak/xhs-ops-a/manual-014",
        currentUrl: "https://www.xiaohongshu.com/explore",
        title: "小红书 - 发现",
        startedAt: "2026-07-06T08:52:00Z",
        message: "手动身份浏览会话运行中；不是 Core Task/Run/Result。",
      },
      boundary:
        "App 只发送启动、查看、接管、释放、停止意图；Harbor 拥有 session、controller、viewer 和 provider truth。",
    },
    taskEntries: [
      {
        id: "task-entry-xhs-real-read",
        label: "启动小红书搜索/笔记读取",
        taskId: "task-xhs-real-read",
        inputSummary: "关键词：AI 工具；可继续读取指定笔记 URL。",
        readiness: "Core/Lode/Harbor fixture 均可投影；真实提交仍由 Core owner API 承接。",
        source: "Core fixture",
      },
      {
        id: "task-entry-xhs-write-preview",
        label: "查看小红书发布草稿写前验证",
        taskId: "task-xhs-publish-write-preview",
        inputSummary: "草稿标题、正文、话题和发布器字段的真实页面写前验证。",
        readiness: "只展示 submitted=false / 未发布 的写前投影；不点击发布。",
        source: "Core fixture",
      },
    ],
  },
  {
    id: "identity-boss-recruiter",
    name: "BOSS 招聘号",
    siteName: "BOSS",
    siteId: "boss",
    origin: "https://www.zhipin.com",
    accountLabel: "招聘号",
    source: "Harbor fixture",
    fetchedAt: "2026-07-06T08:47:00Z",
    identityEnvironmentRef: "harbor://identity-environment/boss-recruiter",
    executionIdentityRef: "harbor://execution-identity/boss-recruiter",
    profileRef: "harbor://profile/boss-recruiter",
    provider: {
      selected: "CloakBrowser",
      role: "默认主力",
      state: "warning",
      reason: "Harbor 选择 CloakBrowser，但现场观测缺少最新登录确认。",
    },
    login: {
      state: "需要人工认证",
      recoveryRequired: true,
      manualAuthenticationState: "需要认证",
      recoveryActions: ["扫码", "二次验证"],
      reason: "登录恢复由 Harbor 浏览器现场完成；App 不读取验证码或密码。",
    },
    environment: {
      proxy: "北京办公出口 · proxy_ref 已配置",
      proxyRef: "proxy_ref_fixture_boss",
      geoipMode: "proxy",
      region: "CN-BJ",
      language: "zh-CN",
      timezone: "Asia/Shanghai",
      browser: "CloakBrowser 145",
      userAgent: "Chrome family / desktop",
      viewport: "1366 x 900",
      hardwareConcurrency: 8,
      deviceMemoryGb: 8,
      gpuProfile: "desktop-default",
      interactionPreset: "default",
      fingerprintStrategy: "provider_default",
      fingerprint: "configured: stable desktop fingerprint summary",
    },
    storage: {
      profileStorage: "存在",
      cookies: "过期",
      credentialRef: "已绑定本机引用",
    },
    readiness: {
      state: "needs-auth",
      label: "需要人工认证",
      reasons: ["登录态过期", "需要扫码或二次验证", "任务运行前必须刷新 Harbor 状态。"],
    },
    siteBindings: ["BOSS 搜索和职位详情读取", "BOSS 打招呼写前预览"],
    browser: {
      providers: [primaryProvider, restrictedChromeProvider],
      defaultProvider: "CloakBrowser",
      targets: manualBrowserTargets,
      session: {
        provider: "CloakBrowser",
        state: "idle",
        statusLabel: "空闲",
        controller: "空闲",
        browserSessionRef: "browser-session://cloak/boss-recruiter/manual-next",
        viewerRef: "viewer://harbor/cloak/boss-recruiter/manual-next",
        currentUrl: "未打开",
        title: "无活动页面",
        startedAt: "未启动",
        message: "可启动到 BOSS 默认页面；可能需要扫码或二次验证。",
      },
      boundary:
        "App 只发送启动、查看、接管、释放、停止意图；Harbor 拥有 session、controller、viewer 和 provider truth。",
    },
    taskEntries: [
      {
        id: "task-entry-boss-real-read",
        label: "启动 BOSS 搜索/职位详情读取",
        taskId: "task-boss-real-read",
        inputSummary: "职位：前端工程师；城市：上海；筛选：近三天。",
        readiness: "登录态需要人工认证时，Task Thread 显示未登录可恢复失败。",
        source: "Core fixture",
      },
      {
        id: "task-entry-boss-write-preview",
        label: "查看 BOSS 打招呼写前验证",
        taskId: "task-boss-greeting-write-preview",
        inputSummary: "目标职位、候选人消息框和打招呼文案的真实页面写前验证。",
        readiness: "只展示 submitted=false / 未发送 的写前投影；不发送消息。",
        source: "Core fixture",
      },
    ],
  },
  {
    id: "identity-local-chrome-dev",
    name: "本机 Chrome 开发环境",
    siteName: "小红书",
    siteId: "xiaohongshu",
    origin: "https://www.xiaohongshu.com",
    accountLabel: "未绑定账号",
    source: "Harbor fixture",
    fetchedAt: "2026-07-06T08:48:00Z",
    identityEnvironmentRef: "harbor://identity-environment/local-chrome-dev",
    executionIdentityRef: "harbor://execution-identity/local-chrome-dev",
    profileRef: "harbor://profile/local-chrome-dev",
    provider: {
      selected: "官方 Chrome",
      role: "受限后备",
      state: "warning",
      reason: "CloakBrowser 缺失或不可启动时才使用；不提供原生指纹控制。",
    },
    login: {
      state: "未知",
      recoveryRequired: true,
      manualAuthenticationState: "需要认证",
      recoveryActions: ["手动登录"],
      reason: "Chrome fallback/dev/manual 不能证明站点任务身份连续性。",
    },
    environment: {
      proxy: "缺失",
      proxyRef: null,
      geoipMode: "system",
      region: "未知",
      language: "zh-CN",
      timezone: "Asia/Shanghai",
      browser: "Google Chrome",
      userAgent: "Chrome official / desktop",
      viewport: "系统默认",
      hardwareConcurrency: null,
      deviceMemoryGb: null,
      gpuProfile: null,
      interactionPreset: "default",
      fingerprintStrategy: "provider_default",
      fingerprint: "not_configured",
    },
    storage: {
      profileStorage: "未知",
      cookies: "未知",
      credentialRef: "未绑定",
    },
    readiness: {
      state: "blocked",
      label: "不建议运行站点任务",
      reasons: ["缺少代理", "缺少指纹摘要", "官方 Chrome 只作为 fallback/dev/manual。"],
    },
    siteBindings: ["开发调试", "人工登录准备"],
    browser: {
      providers: [missingCloakProvider, restrictedChromeProvider],
      defaultProvider: "官方 Chrome",
      targets: manualBrowserTargets,
      session: {
        provider: "官方 Chrome",
        state: "failed",
        statusLabel: "CloakBrowser 缺失",
        controller: "空闲",
        browserSessionRef: "browser-session://chrome/local-dev/manual-next",
        viewerRef: "viewer://harbor/chrome/local-dev/manual-next",
        currentUrl: "未打开",
        title: "无活动页面",
        startedAt: "未启动",
        message: "可用官方 Chrome 受限后备打开手动浏览，但不具备完整身份环境能力。",
      },
      boundary:
        "App 只发送启动、查看、接管、释放、停止意图；Harbor 拥有 session、controller、viewer 和 provider truth。",
    },
    taskEntries: [
      {
        id: "task-entry-local-xhs-read-blocked",
        label: "查看小红书只读任务失败状态",
        taskId: "task-xhs-real-read",
        inputSummary: "本机 Chrome 只作为 fallback/dev/manual，不建议真实站点任务。",
        readiness: "缺少完整身份环境时只能查看 fixture projection，不能声明 live-ready。",
        source: "App local-only",
      },
    ],
  },
];
