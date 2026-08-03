import { realWritePreviewTaskFixtures } from "./realWritePreviewFixtures";
import type { CoreThreadInputSnapshot } from "./coreThreadInputContract";

export type OwnerSource =
  | "Core live"
  | "Core fixture"
  | "Harbor fixture"
  | "Harbor live"
  | "Lode fixture"
  | "App local-only"
  | "App runtime supervisor";

export type OutcomeKind =
  | "success"
  | "empty"
  | "partial"
  | "failure-safe"
  | "failure"
  | "unavailable"
  | "expired"
  | "redacted"
  | "unknown";

export type RunProjection = {
  id: string;
  turnId?: string;
  idempotencyKey?: string;
  label: string;
  lifecycle: "queued" | "running" | "completed" | "needs-action" | "blocked";
  outcome: OutcomeKind;
  summary: string;
  actionIntent: string;
  owner: "Core";
  source: OwnerSource;
  resultRows: Array<{ label: string; value: string; source: OwnerSource }>;
  fieldSources?: Array<{
    field: string;
    value: string;
    locator: string;
    evidenceRef: string;
    source: OwnerSource;
  }>;
  evidenceCards: Array<{
    id: string;
    title: string;
    summary: string;
    viewerLabel: string;
    viewerHref: string;
    source: OwnerSource;
    status?: "available" | "redacted" | "expired" | "stale" | "private" | "unavailable";
    freshness?: string;
    provenance?: string;
  }>;
  capabilityAttribution?: {
    capabilityRef: string;
    version: string;
    sourceRef: string;
    failureClass:
      | "capability"
      | "captcha"
      | "evidence_expired"
      | "field_missing"
      | "input"
      | "login_required"
      | "runtime"
      | "site_changed"
      | "none";
    summary: string;
  };
  failureRecovery?: {
    state: string;
    reason: string;
    nextActions: string[];
    source: OwnerSource;
  };
  writePrecheck?: {
    state: "available" | "preview_unavailable" | "page_changed" | "user_cancelled" | "expired";
    modeLabel: string;
    expectedChangeSummary: string;
    beforeLabel: string;
    afterLabel: string;
    submittedLabel?: string;
    diffRows: Array<{ label: string; before: string; after: string; source: OwnerSource }>;
    noSubmitGuard: "active";
    stateNote: string;
  };
  approval?: {
    actionRequestId: string;
    riskLabel: string;
    riskLevel: "low" | "blocked";
    statuses: Array<{
      label: string;
      status: "pending" | "expired" | "blocked" | "cancelled";
      detail: string;
    }>;
    cancelIntent: string;
    boundary: string;
  };
  process: string[];
  turnStatus?:
    | "submitting"
    | "accepted"
    | "running"
    | "waiting_for_user"
    | "completed"
    | "failed"
    | "cancelled"
    | "status_unknown";
  creationChannel?: "api" | "cli" | "mcp" | "sdk" | "app";
  createdAt?: string;
  updatedAt?: string;
  terminalAt?: string;
  businessInput?: CoreThreadInputSnapshot;
  authorizationDecisionRefs?: string[];
};

export type TaskProjection = {
  id: string;
  updatedAt?: string;
  threadContext?: {
    siteLabel: string;
    siteSkillKey: string;
    accountIdentityKey: string;
  };
  title: string;
  accountIdentity: string;
  identitySource?: OwnerSource;
  siteSkill: string;
  businessInput: string;
  searchQuery?: string;
  source: OwnerSource;
  packageSource: {
    name: string;
    version: string;
    capabilityRef: string;
    sourceRef: string;
    lockRef?: string;
    fetchedAt: string;
    source: OwnerSource;
    boundary: string;
  };
  blocker?: string;
  runs: RunProjection[];
};

export type DirectSessionProjection = {
  id: string;
  title: string;
  accountIdentity: string;
  sessionState: "blocked";
  source: OwnerSource;
  summary: string;
  providerStatus: {
    provider: string;
    browserSessionRef: string;
    status: "connected" | "degraded" | "unavailable";
    viewerRef: string;
    fetchedAt: string;
    source: OwnerSource;
    boundary: string;
  };
};

export const creationEntryFixture = {
  siteSkill: {
    label: "商品详情采集",
    source: "Lode fixture" as OwnerSource,
    blocker: "",
  },
  accountIdentity: {
    label: "运营账号 A",
    source: "Harbor fixture" as OwnerSource,
    blocker: "",
  },
  businessInput: {
    label: "https://example.com/products/road-runner",
    source: "App local-only" as OwnerSource,
    blocker: "",
  },
  coreSource: {
    label: "Core task intent endpoint",
    source: "Core fixture" as OwnerSource,
    blocker: "Missing Core source blocks real submission; this batch stays read-only.",
  },
};

export const taskThreadFixtures: TaskProjection[] = [
  ...realWritePreviewTaskFixtures,
  {
    id: "task-xhs-real-read",
    title: "小红书搜索与笔记读取",
    accountIdentity: "小红书运营号 A",
    siteSkill: "小红书搜索和笔记读取",
    businessInput: "关键词：AI 工具；笔记：https://www.xiaohongshu.com/explore/real-note-2026",
    searchQuery: "AI 工具",
    source: "Core fixture",
    packageSource: {
      name: "@lode/xiaohongshu-read-only",
      version: "0.1.0",
      capabilityRef: "lode:capability/search-notes + lode:capability/read-note-detail",
      sourceRef: "lode://site-capability/xiaohongshu/search-notes@0.1.0 + lode://site-capability/xiaohongshu/read-note-detail@0.1.0",
      lockRef: "lode://lock/site-capability/xiaohongshu/search-notes@0.1.0",
      fetchedAt: "2026-07-06T09:20:00Z",
      source: "Lode fixture",
      boundary: "App 只展示小红书只读 capability metadata、Core run projection 和 Harbor viewer refs；不缓存原始页面材料。",
    },
    runs: [
      {
        id: "run-xhs-search-live",
        label: "小红书 Run 018",
        lifecycle: "running",
        outcome: "partial",
        summary: "Core 已受理小红书搜索真实只读任务；Harbor 会话在发现页读取搜索结果，不做点赞、收藏、评论或发布。",
        actionIntent: "Owner-supported action intent: 打开小红书身份浏览器现场或等待 Core 回读。",
        owner: "Core",
        source: "Core fixture",
        resultRows: [
          { label: "搜索词", value: "AI 工具", source: "Core fixture" },
          { label: "结果数", value: "12 条候选笔记，前 3 条已回读", source: "Core fixture" },
          { label: "执行现场", value: "viewer://harbor/cloak/xhs-ops-a/xhs-search-018", source: "Harbor fixture" },
        ],
        fieldSources: [
          {
            field: "首条笔记标题",
            value: "AI 自动化运营工具清单",
            locator: "page-ref:xhs-search-result-card-1 / element-ref:note-title",
            evidenceRef: "evidence://core/xhs-search-018/result-card-1",
            source: "Core fixture",
          },
          {
            field: "作者昵称",
            value: "增长实验室",
            locator: "page-ref:xhs-search-result-card-1 / element-ref:author-name",
            evidenceRef: "screenshot://harbor/xhs-search-018/viewport-1",
            source: "Harbor fixture",
          },
        ],
        evidenceCards: [
          {
            id: "ev-xhs-search-refmap",
            title: "小红书搜索结果 RefMap",
            summary: "Harbor 只暴露搜索结果卡片 ref、截图 ref 和字段 locator；App 不读取 DOM 或图片正文。",
            viewerLabel: "打开小红书搜索证据",
            viewerHref: "#evidence-viewer-xhs-search-018",
            source: "Harbor fixture",
            status: "available",
            freshness: "fresh",
            provenance: "Core run xhs-search-018 + Harbor viewer ref",
          },
        ],
        capabilityAttribution: {
          capabilityRef: "lode:capability/search-notes",
          version: "0.1.0",
          sourceRef: "lode://site-capability/xiaohongshu/search-notes@0.1.0",
          failureClass: "none",
          summary: "Core run 绑定小红书只读能力和小红书运营号 A 身份环境。",
        },
        process: ["Core accepted read-only task intent.", "Harbor attached xhs-ops-a identity session.", "Search result cards are being read from owner refs."],
      },
      {
        id: "run-xhs-note-success",
        label: "小红书 Run 017",
        lifecycle: "completed",
        outcome: "success",
        summary: "笔记读取完成，标题、作者、正文摘要和互动指标均带字段来源。",
        actionIntent: "Owner-supported action intent: 查看结果依据或再次执行同一输入。",
        owner: "Core",
        source: "Core fixture",
        resultRows: [
          { label: "笔记标题", value: "AI 自动化运营工具清单", source: "Core fixture" },
          { label: "作者", value: "增长实验室", source: "Core fixture" },
          { label: "正文摘要", value: "列出选题、搜索、表格整理和复盘工具。", source: "Core fixture" },
          { label: "互动指标", value: "点赞 1.2k / 收藏 842 / 评论 76", source: "Core fixture" },
        ],
        fieldSources: [
          {
            field: "笔记标题",
            value: "AI 自动化运营工具清单",
            locator: "page-ref:xhs-note-page / element-ref:note-title",
            evidenceRef: "evidence://core/xhs-note-017/title",
            source: "Core fixture",
          },
          {
            field: "正文摘要",
            value: "正文区域前 240 字摘要",
            locator: "page-ref:xhs-note-page / element-ref:note-body",
            evidenceRef: "screenshot://harbor/xhs-note-017/body-fold-1",
            source: "Harbor fixture",
          },
          {
            field: "互动指标",
            value: "点赞、收藏、评论",
            locator: "page-ref:xhs-note-page / element-ref:engagement-bar",
            evidenceRef: "evidence://core/xhs-note-017/engagement",
            source: "Core fixture",
          },
        ],
        evidenceCards: [
          {
            id: "ev-xhs-note-result",
            title: "小红书笔记读取证据入口",
            summary: "字段来源来自 Core Result Envelope，截图和元素引用来自 Harbor viewer；敏感页面材料保持 owner 私有。",
            viewerLabel: "打开小红书笔记证据",
            viewerHref: "#evidence-viewer-xhs-note-017",
            source: "Core fixture",
            status: "available",
            freshness: "fresh",
            provenance: "Core result envelope evidence refs",
          },
        ],
        capabilityAttribution: {
          capabilityRef: "lode:capability/read-note-detail",
          version: "0.1.0",
          sourceRef: "lode://site-capability/xiaohongshu/read-note-detail@0.1.0",
          failureClass: "none",
          summary: "Result Envelope 保留 Lode capability ref、Harbor viewer ref 和字段来源。",
        },
        process: ["Note page loaded through Harbor session.", "Core extracted structured fields.", "Result source refs were attached without raw evidence storage."],
      },
      {
        id: "run-xhs-captcha",
        label: "小红书 Run 016",
        lifecycle: "needs-action",
        outcome: "failure-safe",
        summary: "验证码/滑块校验阻止继续读取；Core 安全暂停，App 不尝试自动绕过。",
        actionIntent: "Owner-supported action intent: 打开执行现场，人工完成认证后从同一 Task 再次执行。",
        owner: "Core",
        source: "Core fixture",
        resultRows: [
          { label: "失败状态", value: "验证码", source: "Core fixture" },
          { label: "失败阶段", value: "search_result_read", source: "Core fixture" },
        ],
        evidenceCards: [
          {
            id: "ev-xhs-captcha",
            title: "验证码状态证据",
            summary: "Harbor 只提供 viewer ref 和人工认证入口；App 不读取验证码内容。",
            viewerLabel: "打开验证码现场",
            viewerHref: "#evidence-viewer-xhs-captcha-016",
            source: "Harbor fixture",
            status: "private",
            freshness: "fresh",
            provenance: "Harbor manual authentication ref",
          },
        ],
        capabilityAttribution: {
          capabilityRef: "lode:capability/search-notes",
          version: "0.1.0",
          sourceRef: "lode://site-capability/xiaohongshu/search-notes@0.1.0",
          failureClass: "captcha",
          summary: "验证码是身份现场恢复问题，不是 App 本地可修复字段。",
        },
        failureRecovery: {
          state: "验证码",
          reason: "站点要求人工校验，自动任务已安全暂停。",
          nextActions: ["打开执行现场", "人工完成认证", "认证后再次执行同一输入"],
          source: "Core fixture",
        },
        process: ["Captcha challenge detected.", "Core paused before additional page reads.", "Harbor viewer ref is available for manual authentication."],
      },
      {
        id: "run-xhs-page-changed",
        label: "小红书 Run 015",
        lifecycle: "blocked",
        outcome: "unavailable",
        summary: "页面结构变化导致搜索结果字段无法稳定定位；App 显示页面变化而不是成功。",
        actionIntent: "Owner-supported action intent: 等待 Lode capability 修复或选择新的笔记 URL。",
        owner: "Core",
        source: "Core fixture",
        resultRows: [
          { label: "失败状态", value: "页面变化", source: "Core fixture" },
          { label: "缺失字段", value: "note_card.title selector changed", source: "Lode fixture" },
        ],
        evidenceCards: [
          {
            id: "ev-xhs-page-changed",
            title: "页面变化证据",
            summary: "Core 标记 site_changed，Lode repair draft 可后续跟进；App 不内置 selector 修复。",
            viewerLabel: "打开页面变化证据",
            viewerHref: "#evidence-viewer-xhs-page-changed-015",
            source: "Core fixture",
            status: "stale",
            freshness: "page_changed",
            provenance: "Core site_changed failure + Lode repair candidate",
          },
        ],
        capabilityAttribution: {
          capabilityRef: "lode:capability/search-notes",
          version: "0.1.0",
          sourceRef: "lode://site-capability/xiaohongshu/search-notes@0.1.0",
          failureClass: "site_changed",
          summary: "页面变化归因到 Lode 能力修复，用户可稍后重试或调整输入。",
        },
        failureRecovery: {
          state: "页面变化",
          reason: "搜索页结构与锁定 capability 的字段定位不一致。",
          nextActions: ["稍后重试", "换用明确笔记 URL", "等待 Lode 修复后再执行"],
          source: "Core fixture",
        },
        process: ["Search page loaded.", "Expected note title locator was missing.", "Core returned site_changed with owner evidence refs."],
      },
    ],
  },
  {
    id: "task-boss-real-read",
    title: "BOSS 搜索与职位详情读取",
    accountIdentity: "BOSS 招聘号",
    siteSkill: "BOSS 搜索和职位详情读取",
    businessInput: "职位：前端工程师；城市：上海；筛选：近三天",
    searchQuery: "前端工程师",
    source: "Core fixture",
    packageSource: {
      name: "@lode/boss-read-only",
      version: "0.1.0",
      capabilityRef: "lode:capability/job-search + lode:capability/read-job-detail",
      sourceRef: "lode://site-capability/boss/job-search@0.1.0 + lode://site-capability/boss/read-job-detail@0.1.0",
      lockRef: "lode://lock/site-capability/boss/job-search@0.1.0",
      fetchedAt: "2026-07-06T09:22:00Z",
      source: "Lode fixture",
      boundary: "App 只展示 BOSS 只读搜索和职位详情 projection；不打招呼、不投递、不保存聊天或简历材料。",
    },
    runs: [
      {
        id: "run-boss-search-live",
        label: "BOSS Run 012",
        lifecycle: "running",
        outcome: "partial",
        summary: "Core 已受理 BOSS 职位搜索真实只读任务；当前正在读取职位列表和详情页来源。",
        actionIntent: "Owner-supported action intent: 打开 BOSS 身份浏览器现场或等待 Core 回读。",
        owner: "Core",
        source: "Core fixture",
        resultRows: [
          { label: "搜索条件", value: "前端工程师 / 上海 / 近三天", source: "Core fixture" },
          { label: "列表结果", value: "8 个职位候选，2 个详情已回读", source: "Core fixture" },
          { label: "执行现场", value: "viewer://harbor/cloak/boss-recruiter/boss-search-012", source: "Harbor fixture" },
        ],
        fieldSources: [
          {
            field: "职位名称",
            value: "高级前端工程师",
            locator: "page-ref:boss-job-list / element-ref:job-card-title",
            evidenceRef: "evidence://core/boss-search-012/job-card-1",
            source: "Core fixture",
          },
          {
            field: "薪资范围",
            value: "25-40K",
            locator: "page-ref:boss-job-list / element-ref:salary",
            evidenceRef: "screenshot://harbor/boss-search-012/list-viewport-1",
            source: "Harbor fixture",
          },
        ],
        evidenceCards: [
          {
            id: "ev-boss-search-refmap",
            title: "BOSS 搜索结果 RefMap",
            summary: "字段来源来自职位卡片 ref 和详情页 viewer ref；App 不读取原始页面正文。",
            viewerLabel: "打开 BOSS 搜索证据",
            viewerHref: "#evidence-viewer-boss-search-012",
            source: "Harbor fixture",
            status: "available",
            freshness: "fresh",
            provenance: "Core run boss-search-012 + Harbor viewer ref",
          },
        ],
        capabilityAttribution: {
          capabilityRef: "lode:capability/job-search",
          version: "0.1.0",
          sourceRef: "lode://site-capability/boss/job-search@0.1.0",
          failureClass: "none",
          summary: "Core run 绑定 BOSS 只读能力和 BOSS 招聘号身份环境。",
        },
        process: ["Core accepted read-only task intent.", "Harbor attached boss-recruiter identity session.", "Job cards and detail links are being read from owner refs."],
      },
      {
        id: "run-boss-detail-success",
        label: "BOSS Run 011",
        lifecycle: "completed",
        outcome: "success",
        summary: "职位详情读取完成，职位、公司、薪资、地点和经验要求均带来源。",
        actionIntent: "Owner-supported action intent: 查看职位详情证据或修改搜索条件。",
        owner: "Core",
        source: "Core fixture",
        resultRows: [
          { label: "职位", value: "高级前端工程师", source: "Core fixture" },
          { label: "公司", value: "上海某 SaaS 公司", source: "Core fixture" },
          { label: "薪资", value: "25-40K · 14 薪", source: "Core fixture" },
          { label: "要求", value: "5-10 年 · React / TypeScript", source: "Core fixture" },
        ],
        fieldSources: [
          {
            field: "职位",
            value: "高级前端工程师",
            locator: "page-ref:boss-job-detail / element-ref:job-title",
            evidenceRef: "evidence://core/boss-detail-011/job-title",
            source: "Core fixture",
          },
          {
            field: "公司",
            value: "上海某 SaaS 公司",
            locator: "page-ref:boss-job-detail / element-ref:company-name",
            evidenceRef: "screenshot://harbor/boss-detail-011/header",
            source: "Harbor fixture",
          },
          {
            field: "经验要求",
            value: "5-10 年 · React / TypeScript",
            locator: "page-ref:boss-job-detail / element-ref:job-requirements",
            evidenceRef: "evidence://core/boss-detail-011/requirements",
            source: "Core fixture",
          },
        ],
        evidenceCards: [
          {
            id: "ev-boss-detail-result",
            title: "BOSS 职位详情证据入口",
            summary: "Core Result Envelope 只保存 evidence refs；详情页截图和元素引用留在 Harbor viewer。",
            viewerLabel: "打开 BOSS 职位详情证据",
            viewerHref: "#evidence-viewer-boss-detail-011",
            source: "Core fixture",
            status: "available",
            freshness: "fresh",
            provenance: "Core result envelope evidence refs",
          },
        ],
        capabilityAttribution: {
          capabilityRef: "lode:capability/read-job-detail",
          version: "0.1.0",
          sourceRef: "lode://site-capability/boss/read-job-detail@0.1.0",
          failureClass: "none",
          summary: "Result Envelope 保留 Lode capability ref、Harbor viewer ref 和字段来源。",
        },
        process: ["Job detail opened through Harbor session.", "Core extracted structured job fields.", "Field source refs were attached without raw evidence storage."],
      },
      {
        id: "run-boss-login-required",
        label: "BOSS Run 010",
        lifecycle: "needs-action",
        outcome: "failure-safe",
        summary: "BOSS 登录态过期，详情页需要扫码或二次验证；任务安全暂停。",
        actionIntent: "Owner-supported action intent: 打开认证现场，重新登录后重试。",
        owner: "Core",
        source: "Core fixture",
        resultRows: [
          { label: "失败状态", value: "未登录", source: "Core fixture" },
          { label: "恢复动作", value: "扫码 / 二次验证 / 刷新 Harbor 状态", source: "Harbor fixture" },
        ],
        evidenceCards: [
          {
            id: "ev-boss-login-required",
            title: "未登录状态证据",
            summary: "Harbor public summary 显示登录态过期；App 只提供认证现场入口。",
            viewerLabel: "打开 BOSS 认证现场",
            viewerHref: "#evidence-viewer-boss-login-required-010",
            source: "Harbor fixture",
            status: "private",
            freshness: "fresh",
            provenance: "Harbor login recovery public summary",
          },
        ],
        capabilityAttribution: {
          capabilityRef: "lode:capability/read-job-detail",
          version: "0.1.0",
          sourceRef: "lode://site-capability/boss/read-job-detail@0.1.0",
          failureClass: "login_required",
          summary: "未登录是身份环境恢复问题，不是职位读取能力成功。",
        },
        failureRecovery: {
          state: "未登录",
          reason: "招聘号登录态过期，详情页读取前需要人工认证。",
          nextActions: ["打开认证现场", "扫码或完成二次验证", "刷新身份环境后再次执行"],
          source: "Core fixture",
        },
        process: ["Harbor reported expired cookies.", "Core paused before job detail read.", "App kept failure-safe state visible."],
      },
      {
        id: "run-boss-field-missing",
        label: "BOSS Run 009",
        lifecycle: "completed",
        outcome: "partial",
        summary: "职位详情返回成功但公司规模字段缺失；App 展示字段缺失和可追踪来源。",
        actionIntent: "Owner-supported action intent: 调整搜索条件、刷新页面或等待能力修复。",
        owner: "Core",
        source: "Core fixture",
        resultRows: [
          { label: "职位", value: "前端开发工程师", source: "Core fixture" },
          { label: "公司规模", value: "字段缺失", source: "Core fixture" },
          { label: "原因", value: "company_size element missing", source: "Lode fixture" },
        ],
        fieldSources: [
          {
            field: "职位",
            value: "前端开发工程师",
            locator: "page-ref:boss-job-detail / element-ref:job-title",
            evidenceRef: "evidence://core/boss-field-missing-009/title",
            source: "Core fixture",
          },
          {
            field: "公司规模",
            value: "不可追：目标元素缺失",
            locator: "page-ref:boss-company-card / element-ref:company-size missing",
            evidenceRef: "evidence://core/boss-field-missing-009/missing-field",
            source: "Core fixture",
          },
        ],
        evidenceCards: [
          {
            id: "ev-boss-field-missing",
            title: "字段缺失证据",
            summary: "Core 保留 missing-field record，说明关键字段不可追而不是静默留空。",
            viewerLabel: "打开字段缺失证据",
            viewerHref: "#evidence-viewer-boss-field-missing-009",
            source: "Core fixture",
            status: "available",
            freshness: "fresh",
            provenance: "Core missing field record",
          },
        ],
        capabilityAttribution: {
          capabilityRef: "lode:capability/read-job-detail",
          version: "0.1.0",
          sourceRef: "lode://site-capability/boss/read-job-detail@0.1.0",
          failureClass: "field_missing",
          summary: "字段缺失归因到页面字段不可见或 selector 漂移；结果保持 partial。",
        },
        failureRecovery: {
          state: "字段缺失",
          reason: "公司规模字段在当前详情页不可见，不能伪造值。",
          nextActions: ["刷新页面后重试", "换一个职位详情", "等待 Lode selector 修复"],
          source: "Core fixture",
        },
        process: ["Required job fields passed.", "Company size field was not visible.", "Core returned partial result with missing-field evidence."],
      },
    ],
  },
  {
    id: "task-contact-form-preview",
    title: "预览联系表单草稿",
    accountIdentity: "本机 Chrome",
    siteSkill: "联系表单写前预览",
    businessInput: "https://example.org/contact",
    source: "Core fixture",
    packageSource: {
      name: "@lode/example-preview-contact-form",
      version: "0.1.0",
      capabilityRef: "lode:capability/preview-contact-form",
      sourceRef: "lode://site-capability/example/preview-contact-form@0.1.0",
      lockRef: "lode://lock/site-capability/example/preview-contact-form@0.1.0",
      fetchedAt: "2026-07-06T00:00:00Z",
      source: "Lode fixture",
      boundary: "App displays write-pre package refs and expected-change summaries only; Lode keeps package truth.",
    },
    runs: [
      {
        id: "run-preview-available",
        label: "Preview 003",
        lifecycle: "needs-action",
        outcome: "partial",
        summary: "Validate-only preview ready. Nothing has been submitted.",
        actionIntent: "Owner-supported cancel intent: request Core to record user_cancelled without executing submit.",
        owner: "Core",
        source: "Core fixture",
        resultRows: [
          { label: "Result kind", value: "validate_only_preview", source: "Core fixture" },
          { label: "Submitted", value: "false", source: "Core fixture" },
          { label: "Draft state", value: "preview available", source: "Core fixture" },
        ],
        evidenceCards: [
          {
            id: "ev-preview-before",
            title: "Before-preview Snapshot/RefMap refs",
            summary: "Harbor fixture exposes refs, provenance, and freshness only; raw page material stays private.",
            viewerLabel: "Open preview evidence viewer link",
            viewerHref: "#evidence-viewer-preview-before",
            source: "Harbor fixture",
            status: "available",
            freshness: "fresh",
            provenance: "harbor-preview-evidence-status-fixture/v0",
          },
        ],
        capabilityAttribution: {
          capabilityRef: "lode:capability/preview-contact-form",
          version: "0.1.0",
          sourceRef: "lode://site-capability/example/preview-contact-form@0.1.0",
          failureClass: "none",
          summary: "Core preview Result Envelope links the action, evidence refs, and locked Lode capability version.",
        },
        writePrecheck: {
          state: "available",
          modeLabel: "validate-only preview / draft",
          expectedChangeSummary: "Validate contact form target and prepare a local preview without submitting.",
          beforeLabel: "Message field unchanged on page",
          afterLabel: "Local draft value prepared for review only",
          diffRows: [
            {
              label: "contact.message",
              before: "empty",
              after: "local preview value",
              source: "Lode fixture",
            },
            {
              label: "external_submit",
              before: "not requested",
              after: "false",
              source: "Core fixture",
            },
          ],
          noSubmitGuard: "active",
          stateNote: "Preview is available; this is not a submitted result.",
        },
        approval: {
          actionRequestId: "action-request:fixture/preview-contact-form",
          riskLabel: "write / low / validate_only",
          riskLevel: "low",
          statuses: [
            {
              label: "Approval request",
              status: "pending",
              detail: "Pending user review before any future submit-capable stage.",
            },
            {
              label: "Expired approval",
              status: "expired",
              detail: "Expired requests remain non-executable.",
            },
            {
              label: "Blocked approval",
              status: "blocked",
              detail: "Policy blocks execution; App shows state only.",
            },
            {
              label: "Cancellation record",
              status: "cancelled",
              detail: "Core cancellation summary uses user_cancelled and is not submitted.",
            },
          ],
          cancelIntent: "Cancel intent is local UI intent until Core records cancellation; no submit is sent.",
          boundary: "Core owns action request, approval, cancellation, and no-submit guard truth.",
        },
        process: [
          "Core returned action request risk classification with no-submit guard active.",
          "Lode supplied expected_change and risk_hints from write-pre fixture.",
          "Harbor supplied before-preview refs and freshness without raw material.",
        ],
      },
      {
        id: "run-preview-page-changed",
        label: "Preview 002",
        lifecycle: "blocked",
        outcome: "unavailable",
        summary: "Preview blocked because the page changed after refs were captured.",
        actionIntent: "Owner-supported action intent: refresh preview evidence before approval.",
        owner: "Core",
        source: "Core fixture",
        resultRows: [
          { label: "Preview state", value: "page_changed", source: "Core fixture" },
          { label: "Submitted", value: "false", source: "Core fixture" },
        ],
        evidenceCards: [
          {
            id: "ev-preview-page-changed",
            title: "Stale RefMap preview evidence",
            summary: "Harbor freshness reports page_changed; App blocks the preview instead of showing success.",
            viewerLabel: "Open stale preview evidence link",
            viewerHref: "#evidence-viewer-preview-page-changed",
            source: "Harbor fixture",
            status: "stale",
            freshness: "page_changed",
            provenance: "harbor-preview-evidence-status-fixture/v0",
          },
        ],
        capabilityAttribution: {
          capabilityRef: "lode:capability/preview-contact-form",
          version: "0.1.0",
          sourceRef: "lode://site-capability/example/preview-contact-form@0.1.0",
          failureClass: "site_changed",
          summary: "Core classifies page_changed as preview failure, not submitted result.",
        },
        writePrecheck: {
          state: "page_changed",
          modeLabel: "validate-only preview",
          expectedChangeSummary: "Expected change is withheld until fresh evidence is available.",
          beforeLabel: "Captured RefMap is stale",
          afterLabel: "No draft can be trusted",
          diffRows: [
            { label: "freshness", before: "fresh", after: "page_changed", source: "Harbor fixture" },
            { label: "submitted", before: "false", after: "false", source: "Core fixture" },
          ],
          noSubmitGuard: "active",
          stateNote: "Preview unavailable because the page changed; refresh evidence first.",
        },
        process: ["Harbor detected page_changed.", "Core returned preview failure.", "App kept submitted=false visible."],
      },
      {
        id: "run-preview-cancelled",
        label: "Preview 001",
        lifecycle: "needs-action",
        outcome: "failure-safe",
        summary: "User cancelled the write-pre flow; no external submit was attempted.",
        actionIntent: "Owner-supported action intent: start a new validate-only preview.",
        owner: "Core",
        source: "Core fixture",
        resultRows: [
          { label: "Preview state", value: "user_cancelled", source: "Core fixture" },
          { label: "Submitted", value: "false", source: "Core fixture" },
        ],
        evidenceCards: [
          {
            id: "ev-preview-cancelled",
            title: "Cancellation evidence refs",
            summary: "Cancellation links action refs and evidence refs only.",
            viewerLabel: "Open cancellation evidence link",
            viewerHref: "#evidence-viewer-preview-cancelled",
            source: "Core fixture",
            status: "available",
            freshness: "fresh",
            provenance: "approval-cancellation-query.fixture.json",
          },
        ],
        capabilityAttribution: {
          capabilityRef: "lode:capability/preview-contact-form",
          version: "0.1.0",
          sourceRef: "lode://site-capability/example/preview-contact-form@0.1.0",
          failureClass: "none",
          summary: "Cancelled preview is preserved as write-pre history without submitted success.",
        },
        writePrecheck: {
          state: "user_cancelled",
          modeLabel: "draft cancelled",
          expectedChangeSummary: "No expected change is active after cancellation.",
          beforeLabel: "Draft pending user review",
          afterLabel: "Cancelled before submit-capable stage",
          diffRows: [
            { label: "approval", before: "pending", after: "cancelled", source: "Core fixture" },
            { label: "submitted", before: "false", after: "false", source: "Core fixture" },
          ],
          noSubmitGuard: "active",
          stateNote: "Cancellation is a terminal write-pre state, not submitted success.",
        },
        process: ["User cancellation recorded.", "Core preserved no-submit boundary.", "Run history displays cancelled as write-pre state."],
      },
    ],
  },
  {
    id: "task-product-page",
    title: "采集商品详情页",
    accountIdentity: "运营账号 A",
    siteSkill: "商品详情采集",
    businessInput: "https://example.com/products/road-runner",
    source: "Core fixture",
    packageSource: {
      name: "@lode/example-commerce-product-detail",
      version: "0.4.2",
      capabilityRef: "lode://capability/example-commerce/product-detail",
      sourceRef: "lode://package/example-commerce-product-detail@0.4.2",
      lockRef: "lode://lock/example-commerce-product-detail/2026-07-03",
      fetchedAt: "2026-07-03T04:20:00Z",
      source: "Lode fixture",
      boundary: "App only displays capability package metadata; workflow runtime/editor stays out of scope.",
    },
    runs: [
      {
        id: "run-running",
        label: "Run 006",
        lifecycle: "running",
        outcome: "partial",
        summary: "正在采集变体价格；已返回核心商品字段，等待 Core 完成最终归档。",
        actionIntent: "Owner-supported action intent: watch live run.",
        owner: "Core",
        source: "Core fixture",
        resultRows: [
          { label: "商品名", value: "Road Runner Keyboard", source: "Core fixture" },
          { label: "价格", value: "Collecting variants", source: "Core fixture" },
          { label: "库存", value: "Pending", source: "Core fixture" },
        ],
        evidenceCards: [
          {
            id: "ev-run-006-live",
            title: "Live run evidence projection",
            summary: "Core fixture reports a running task projection; App does not stream raw trace.",
            viewerLabel: "Open evidence viewer link",
            viewerHref: "#evidence-viewer-run-006",
            source: "Core fixture",
            status: "available",
            freshness: "fresh",
            provenance: "Core run record + Harbor viewer ref",
          },
        ],
        capabilityAttribution: {
          capabilityRef: "lode://capability/example-commerce/product-detail",
          version: "0.4.2",
          sourceRef: "lode://package/example-commerce-product-detail@0.4.2",
          failureClass: "none",
          summary: "Core attributes this run to the locked Lode capability ref.",
        },
        process: ["Core accepted task intent.", "Harbor identity attached.", "Variant price extraction is still running."],
      },
      {
        id: "run-review",
        label: "Run 005",
        lifecycle: "needs-action",
        outcome: "failure-safe",
        summary: "需要用户确认站点弹窗；Core 已安全暂停，未执行写入。",
        actionIntent: "Owner-supported action intent: inspect runtime session.",
        owner: "Core",
        source: "Core fixture",
        resultRows: [
          { label: "暂停原因", value: "Site confirmation modal", source: "Core fixture" },
          { label: "安全边界", value: "No write attempted", source: "Core fixture" },
        ],
        evidenceCards: [
          {
            id: "ev-run-005-modal",
            title: "Needs-action evidence",
            summary: "Core-owned projection records a blocked modal without raw DOM cached in App.",
            viewerLabel: "Open evidence viewer link",
            viewerHref: "#evidence-viewer-run-005",
            source: "Core fixture",
            status: "private",
            freshness: "fresh",
            provenance: "Harbor private capture redacted to viewer ref",
          },
        ],
        capabilityAttribution: {
          capabilityRef: "lode://capability/example-commerce/product-detail",
          version: "0.4.2",
          sourceRef: "lode://package/example-commerce-product-detail@0.4.2",
          failureClass: "runtime",
          summary: "Failure attribution: runtime needs user action, not package repair.",
        },
        process: ["Product page loaded.", "Site modal blocked automation.", "Core paused before write-capable action."],
      },
      {
        id: "run-success",
        label: "Run 004",
        lifecycle: "completed",
        outcome: "success",
        summary: "任务成功完成，结构化结果来自 Core fixture projection。",
        actionIntent: "Owner-supported action intent: view result sources.",
        owner: "Core",
        source: "Core fixture",
        resultRows: [
          { label: "商品名", value: "Road Runner Keyboard", source: "Core fixture" },
          { label: "价格", value: "$129", source: "Core fixture" },
          { label: "库存", value: "In stock", source: "Core fixture" },
        ],
        evidenceCards: [
          {
            id: "ev-run-004-result",
            title: "Result evidence projection",
            summary: "Core-owned evidence summary, no raw evidence body cached in App.",
            viewerLabel: "Open evidence viewer link",
            viewerHref: "#evidence-viewer-run-004",
            source: "Core fixture",
            status: "available",
            freshness: "fresh",
            provenance: "Core result envelope evidence ref",
          },
        ],
        capabilityAttribution: {
          capabilityRef: "lode://capability/example-commerce/product-detail",
          version: "0.4.2",
          sourceRef: "lode://package/example-commerce-product-detail@0.4.2",
          failureClass: "none",
          summary: "Capability attribution retained on the run record.",
        },
        process: ["Core accepted read-only task intent.", "Lode capability metadata matched.", "Harbor identity was referenced, not stored."],
      },
      {
        id: "run-empty",
        label: "Run 003",
        lifecycle: "completed",
        outcome: "empty",
        summary: "任务完成但没有匹配记录；empty outcome 不等于 failure。",
        actionIntent: "Owner-supported action intent: modify input.",
        owner: "Core",
        source: "Core fixture",
        resultRows: [{ label: "结果", value: "No matching rows", source: "Core fixture" }],
        evidenceCards: [
          {
            id: "ev-run-003-empty",
            title: "Empty result evidence",
            summary: "Core says extraction completed with zero rows; App links the viewer only.",
            viewerLabel: "Open evidence viewer link",
            viewerHref: "#evidence-viewer-run-003",
            source: "Core fixture",
            status: "available",
            freshness: "fresh",
            provenance: "Core empty result envelope",
          },
        ],
        capabilityAttribution: {
          capabilityRef: "lode://capability/example-commerce/product-detail",
          version: "0.4.2",
          sourceRef: "lode://package/example-commerce-product-detail@0.4.2",
          failureClass: "input",
          summary: "Empty result is attributed to input content, not capability failure.",
        },
        process: ["Page loaded.", "Extractor returned zero rows.", "Core closed run as empty."],
      },
      {
        id: "run-partial",
        label: "Run 002",
        lifecycle: "completed",
        outcome: "partial",
        summary: "任务部分完成，缺少可选字段；partial outcome 保留缺口。",
        actionIntent: "Owner-supported action intent: retry run.",
        owner: "Core",
        source: "Core fixture",
        resultRows: [
          { label: "商品名", value: "Road Runner Keyboard", source: "Core fixture" },
          { label: "价格", value: "Unavailable", source: "Core fixture" },
        ],
        evidenceCards: [
          {
            id: "ev-run-002-partial",
            title: "Partial field evidence",
            summary: "Core-owned projection shows required fields passed and optional price missing.",
            viewerLabel: "Open evidence viewer link",
            viewerHref: "#evidence-viewer-run-002",
            source: "Core fixture",
            status: "stale",
            freshness: "stale",
            provenance: "Harbor evidence ref marked stale",
          },
        ],
        capabilityAttribution: {
          capabilityRef: "lode://capability/example-commerce/product-detail",
          version: "0.4.2",
          sourceRef: "lode://package/example-commerce-product-detail@0.4.2",
          failureClass: "site_changed",
          summary: "Failure attribution: optional selector drift suggests site_changed repair draft.",
        },
        process: ["Required fields passed.", "Optional price selector was unavailable.", "Core returned partial result."],
      },
      {
        id: "run-failure-safe",
        label: "Run 001",
        lifecycle: "needs-action",
        outcome: "failure-safe",
        summary: "任务安全失败，没有执行写入或保存 raw evidence。",
        actionIntent: "Owner-supported action intent: open runtime session.",
        owner: "Core",
        source: "Core fixture",
        resultRows: [{ label: "安全结果", value: "No write was attempted", source: "Core fixture" }],
        evidenceCards: [
          {
            id: "ev-run-001-safe",
            title: "Failure-safe evidence",
            summary: "Evidence projection confirms no write attempt and no raw evidence saved.",
            viewerLabel: "Open evidence viewer link",
            viewerHref: "#evidence-viewer-run-001",
            source: "Core fixture",
            status: "private",
            freshness: "fresh",
            provenance: "Harbor private runtime ref",
          },
        ],
        capabilityAttribution: {
          capabilityRef: "lode://capability/example-commerce/product-detail",
          version: "0.4.2",
          sourceRef: "lode://package/example-commerce-product-detail@0.4.2",
          failureClass: "runtime",
          summary: "Failure attribution: runtime/login challenge blocked the run.",
        },
        process: ["Login challenge detected.", "Core stopped before extraction.", "Failure-safe report created."],
      },
    ],
  },
  {
    id: "task-source-blocked",
    title: "缺少 source 的只读任务",
    accountIdentity: "运营账号 A",
    siteSkill: "商品详情采集",
    businessInput: "https://example.com/products/source-missing",
    source: "Core fixture",
    packageSource: {
      name: "@lode/example-commerce-product-detail",
      version: "0.4.2",
      capabilityRef: "lode://capability/example-commerce/product-detail",
      sourceRef: "lode://package/example-commerce-product-detail@0.4.2",
      lockRef: "lode://lock/example-commerce-product-detail/2026-07-03",
      fetchedAt: "2026-07-03T04:20:00Z",
      source: "Lode fixture",
      boundary: "Missing Core source does not change Lode package attribution.",
    },
    blocker: "Missing owner source: Core run source is unavailable, so App must show blocker.",
    runs: [
      {
        id: "run-unavailable",
        label: "Run unavailable",
        lifecycle: "blocked",
        outcome: "unavailable",
        summary: "Core source unavailable；不能本地转换为 task success。",
        actionIntent: "Owner-supported action intent: wait for Core source.",
        owner: "Core",
        source: "Core fixture",
        resultRows: [{ label: "结果", value: "Unavailable", source: "Core fixture" }],
        evidenceCards: [
          {
            id: "ev-unavailable",
            title: "Unavailable evidence source",
            summary: "Core source is unavailable, so App shows a blocker instead of a result.",
            viewerLabel: "Evidence viewer unavailable",
            viewerHref: "#evidence-viewer-unavailable",
            source: "Core fixture",
            status: "unavailable",
            freshness: "unavailable",
            provenance: "Core source health blocker",
          },
        ],
        capabilityAttribution: {
          capabilityRef: "lode://capability/example-commerce/product-detail",
          version: "0.4.2",
          sourceRef: "lode://package/example-commerce-product-detail@0.4.2",
          failureClass: "runtime",
          summary: "Failure attribution: Core source health is blocking evidence lookup.",
        },
        process: ["Source health unavailable.", "Task submission remains read-only.", "No Core Run Record is created by App."],
      },
      {
        id: "run-expired",
        label: "Run expired",
        lifecycle: "needs-action",
        outcome: "expired",
        summary: "结果引用已过期；只能提示 owner-supported action intent。",
        actionIntent: "Owner-supported action intent: request fresh run.",
        owner: "Core",
        source: "Core fixture",
        resultRows: [{ label: "结果", value: "Expired", source: "Core fixture" }],
        evidenceCards: [
          {
            id: "ev-expired",
            title: "Expired evidence reference",
            summary: "Core projection expired; App does not keep a local raw evidence copy.",
            viewerLabel: "Request fresh evidence viewer link",
            viewerHref: "#evidence-viewer-expired",
            source: "Core fixture",
            status: "expired",
            freshness: "expired",
            provenance: "Harbor evidence lifecycle",
          },
        ],
        capabilityAttribution: {
          capabilityRef: "lode://capability/example-commerce/product-detail",
          version: "0.4.2",
          sourceRef: "lode://package/example-commerce-product-detail@0.4.2",
          failureClass: "evidence_expired",
          summary: "Failure attribution: evidence refs expired; request fresh evidence before repair.",
        },
        process: ["Core reported expired result projection.", "App did not cache raw evidence."],
      },
      {
        id: "run-redacted",
        label: "Run redacted",
        lifecycle: "completed",
        outcome: "redacted",
        summary: "字段被 owner policy redacted；不能在 App 中恢复敏感内容。",
        actionIntent: "Owner-supported action intent: view allowed fields.",
        owner: "Core",
        source: "Core fixture",
        resultRows: [{ label: "账号字段", value: "Redacted by owner policy", source: "Core fixture" }],
        evidenceCards: [
          {
            id: "ev-redacted",
            title: "Redacted evidence projection",
            summary: "Owner policy redacted sensitive fields before App display.",
            viewerLabel: "Open allowed evidence viewer link",
            viewerHref: "#evidence-viewer-redacted",
            source: "Core fixture",
            status: "redacted",
            freshness: "fresh",
            provenance: "Harbor redacted fixture",
          },
        ],
        capabilityAttribution: {
          capabilityRef: "lode://capability/example-commerce/product-detail",
          version: "0.4.2",
          sourceRef: "lode://package/example-commerce-product-detail@0.4.2",
          failureClass: "none",
          summary: "Redaction is policy state, not capability failure.",
        },
        process: ["Core returned redacted projection.", "Renderer displayed policy boundary."],
      },
      {
        id: "run-unknown",
        label: "Run unknown",
        lifecycle: "needs-action",
        outcome: "unknown",
        summary: "unknown outcome 需要人工确认；不能显示为成功。",
        actionIntent: "Owner-supported action intent: open diagnostics.",
        owner: "Core",
        source: "Core fixture",
        resultRows: [{ label: "结果", value: "Unknown outcome", source: "Core fixture" }],
        evidenceCards: [
          {
            id: "ev-unknown",
            title: "Unknown outcome evidence",
            summary: "Core cannot classify the run; App keeps the uncertainty visible.",
            viewerLabel: "Open evidence viewer link",
            viewerHref: "#evidence-viewer-unknown",
            source: "Core fixture",
            status: "stale",
            freshness: "unknown",
            provenance: "Core unknown result fixture",
          },
        ],
        capabilityAttribution: {
          capabilityRef: "lode://capability/example-commerce/product-detail",
          version: "0.4.2",
          sourceRef: "lode://package/example-commerce-product-detail@0.4.2",
          failureClass: "site_changed",
          summary: "Failure attribution remains unresolved and links back to capability health.",
        },
        process: ["Run state could not be classified.", "App keeps unknown outcome visible."],
      },
      {
        id: "run-failure",
        label: "Run failure",
        lifecycle: "completed",
        outcome: "failure",
        summary: "任务失败，报告失败阶段和下一步动作。",
        actionIntent: "Owner-supported action intent: fix input and retry.",
        owner: "Core",
        source: "Core fixture",
        resultRows: [{ label: "失败阶段", value: "Input validation", source: "Core fixture" }],
        evidenceCards: [
          {
            id: "ev-failure",
            title: "Failure stage evidence",
            summary: "Core rejected invalid input; App does not convert this into success.",
            viewerLabel: "Open evidence viewer link",
            viewerHref: "#evidence-viewer-failure",
            source: "Core fixture",
            status: "available",
            freshness: "fresh",
            provenance: "Core admission failure fixture",
          },
        ],
        capabilityAttribution: {
          capabilityRef: "lode://capability/example-commerce/product-detail",
          version: "0.4.2",
          sourceRef: "lode://package/example-commerce-product-detail@0.4.2",
          failureClass: "input",
          summary: "Failure attribution: input validation, not Lode package repair.",
        },
        process: ["Core rejected invalid business input.", "No task success was shown."],
      },
    ],
  },
];

export const directSessionFixture: DirectSessionProjection = {
  id: "direct-session-local-chrome",
  title: "本机 Chrome 手动浏览实例",
  accountIdentity: "本机 Chrome",
  sessionState: "blocked",
  source: "Harbor fixture",
  summary:
    "Harbor fixture direct session is demo-only and blocked in real mode; it is not Core Task/Run/Result and is not launchable.",
  providerStatus: {
    provider: "Harbor Browser provider fixture",
    browserSessionRef: "browser-session://local-chrome/manual-001",
    status: "unavailable",
    viewerRef: "viewer://harbor/local-chrome/manual-001",
    fetchedAt: "2026-07-03T04:20:00Z",
    source: "Harbor fixture",
    boundary: "Provider private endpoint, raw CDP, VNC, credential, cookie, and profile storage are not exposed.",
  },
};
