import type {
  BrowserProviderCapabilityFact,
  BrowserProviderCapabilityKey,
  BrowserProviderCapabilityState,
  BrowserProviderDownloadGuide,
  BrowserProviderFactSource
} from "./provider-management.js";

export function cloakCapabilities(): BrowserProviderCapabilityFact[] {
  return [
    capability("persistent_profile", "supported", "configured", "使用专用持久化浏览器 profile 存储。"),
    capability("independent_user_data_dir", "supported", "configured", "身份环境数据与用户日常浏览器数据分离。"),
    capability("proxy", "limited", "configured", "Harbor 仅通过本机 resolver 和 Chromium 启动参数应用代理，并要求运行时参数 readback。"),
    capability("timezone", "limited", "configured", "Harbor 通过 CDP timezone override 应用并读取实际时区。"),
    capability("locale", "limited", "configured", "Harbor 通过 Chromium locale override 应用并读取实际语言；独立地区伪装不受支持。"),
    capability("viewport", "limited", "configured", "Harbor 通过 Chromium device metrics override 应用并读取实际 viewport。"),
    capability("extensions", "supported", "configured", "扩展能力沿用 Chromium profile 模型。"),
    capability("cookie_persistence", "supported", "configured", "Cookie 会随专用 profile 持久化。"),
    capability("cdp", "supported", "configured", "Harbor 可通过 CDP ref 启动或连接，不暴露原始 endpoint。"),
    capability("viewer", "limited", "provider_claim", "Viewer 只作为 Manager 机制参考，不是公开原始 endpoint。"),
    capability("snapshot_refs", "limited", "configured", "Harbor snapshot ref 依赖存活的 Runtime Session。"),
    capability("evidence_refs", "limited", "configured", "Harbor evidence ref 依赖策略和存活的 Runtime Session。"),
    capability("native_fingerprint_control", "provider_claim", "provider_claim", "原生指纹控制在 Harbor 有验证证据前只记为 provider claim。"),
    capability("anti_detection_binary_patches", "provider_claim", "provider_claim", "反检测补丁只记录为能力声明，不承诺任务成功率。"),
    capability("automation_exposure_reduction", "provider_claim", "provider_claim", "provider 声称降低自动化暴露；Harbor 不承诺目标站点通过。")
  ];
}

export function chromeCapabilities(): BrowserProviderCapabilityFact[] {
  return [
    capability("persistent_profile", "limited", "configured", "Harbor 可使用专用 profile，但 Chrome 没有 provider 原生身份控制。"),
    capability("independent_user_data_dir", "supported", "configured", "专用 user data dir 可隔离 Harbor 与日常 Chrome。"),
    capability("proxy", "limited", "configured", "代理可在启动或环境层配置，但缺少 provider 原生一致性事实。"),
    capability("timezone", "limited", "configured", "时区只能通过自动化层或系统层处理，不是原生指纹控制。"),
    capability("locale", "limited", "configured", "语言区域可配置，但一致性能力有限。"),
    capability("viewport", "limited", "configured", "视口可通过自动化配置。"),
    capability("extensions", "limited", "configured", "扩展能力取决于启动模式和用户策略。"),
    capability("cookie_persistence", "supported", "configured", "Cookie 会随专用 profile 持久化。"),
    capability("cdp", "supported", "configured", "Chrome 支持 CDP ref。"),
    capability("viewer", "limited", "configured", "可观察本地窗口，但 Harbor viewer facts 仍由 Harbor 中介。"),
    capability("snapshot_refs", "limited", "configured", "Harbor snapshot ref 依赖存活的 Runtime Session。"),
    capability("evidence_refs", "limited", "configured", "Harbor evidence ref 依赖策略和存活的 Runtime Session。"),
    capability("native_fingerprint_control", "unsupported", "configured", "官方 Chrome 不提供 provider 原生指纹控制。"),
    capability("anti_detection_binary_patches", "unsupported", "configured", "官方 Chrome 没有 CloakBrowser 二进制补丁。"),
    capability("automation_exposure_reduction", "limited", "configured", "Harbor 可降低部分临时自动化暴露，但不能提供完整身份一致性。")
  ];
}

export function camoufoxCapabilities(official = false): BrowserProviderCapabilityFact[] {
  if (official) return [
    capability("persistent_profile", "supported", "validation_evidence", "通过原版 Playwright persistent context 使用 Harbor 专用 Profile。"),
    capability("independent_user_data_dir", "supported", "validation_evidence", "任务 Page 使用独立 managed Profile，不复用用户日常 Profile。"),
    capability("proxy", "limited", "validation_evidence", "仅通过公开 Playwright proxy 参数应用，并由 owner 配置 resolver。"),
    capability("timezone", "limited", "validation_evidence", "仅支持固定环境配置并在 Page environment readback 中报告。"),
    capability("locale", "limited", "validation_evidence", "仅支持公开 Playwright locale 配置并在 Page environment readback 中报告。"),
    capability("viewport", "limited", "validation_evidence", "仅支持公开 persistent context viewport 配置。"),
    capability("extensions", "unsupported", "derived", "当前 vertical slice 不加载或管理扩展。"),
    capability("cookie_persistence", "supported", "validation_evidence", "Cookie 随 managed Profile 持久化。"),
    capability("cdp", "unsupported", "validation_evidence", "原版 JSONL Driver 不暴露 CDP endpoint；Harbor 使用公开 Playwright Page。"),
    capability("viewer", "limited", "validation_evidence", "原生焦点是可选 Viewer 事实，与 task Page 控制分离。"),
    capability("snapshot_refs", "limited", "validation_evidence", "snapshot 仅生成有界 control refs，不暴露 raw DOM。"),
    capability("evidence_refs", "limited", "validation_evidence", "diagnostics/environment 只返回有界脱敏事实。"),
    capability("native_fingerprint_control", "provider_claim", "provider_claim", "原版 Camoufox 能力不被 Harbor 重新实现或承诺。"),
    capability("anti_detection_binary_patches", "unsupported", "derived", "Harbor 不接受或加载任何 patched/native504/native510 构件。"),
    capability("automation_exposure_reduction", "provider_claim", "provider_claim", "仅记录原版 provider claim，不承诺目标站点结果。")
  ];
  return [
    capability("persistent_profile", "unsupported", "derived", "Camoufox 私有浏览器/Driver 绑定已退役。"),
    capability("independent_user_data_dir", "unsupported", "derived", "Camoufox 私有浏览器/Driver 绑定已退役。"),
    capability("proxy", "unsupported", "derived", "Camoufox 私有浏览器/Driver 绑定已退役。"),
    capability("timezone", "unsupported", "derived", "Camoufox 私有浏览器/Driver 绑定已退役。"),
    capability("locale", "unsupported", "derived", "Camoufox 私有浏览器/Driver 绑定已退役。"),
    capability("viewport", "unsupported", "derived", "Camoufox 私有浏览器/Driver 绑定已退役。"),
    capability("extensions", "unsupported", "derived", "Camoufox 私有浏览器/Driver 绑定已退役。"),
    capability("cookie_persistence", "unsupported", "derived", "Camoufox 私有浏览器/Driver 绑定已退役。"),
    capability("cdp", "unsupported", "derived", "Camoufox 私有浏览器/Driver 绑定已退役。"),
    capability("viewer", "unsupported", "derived", "Camoufox 私有浏览器/Driver 绑定已退役。"),
    capability("snapshot_refs", "unsupported", "derived", "Camoufox 私有浏览器/Driver 绑定已退役。"),
    capability("evidence_refs", "unsupported", "derived", "Camoufox 私有浏览器/Driver 绑定已退役。"),
    capability("native_fingerprint_control", "unsupported", "derived", "Camoufox 私有浏览器/Driver 绑定已退役。"),
    capability("anti_detection_binary_patches", "unsupported", "derived", "Camoufox 私有浏览器/Driver 绑定已退役。"),
    capability("automation_exposure_reduction", "unsupported", "derived", "Camoufox 私有浏览器/Driver 绑定已退役。")
  ];
}

export function cloakLimitations(): string[] {
  return [
    "provider claim 必须有 Harbor 验证证据后，Core 才能当作 observed fact 使用。",
    "Harbor 只在已授权的 managed lifecycle 操作中从官方签名来源下载，不重新分发 CloakBrowser 二进制。",
    "不暴露目标站点通过率或反检测成功保证。"
  ];
}

export function chromeLimitations(): string[] {
  return [
    "仅在 CloakBrowser 缺失或不可用时作为受限后备。",
    "没有原生指纹控制或反检测二进制补丁。",
    "必须展示为身份环境一致性受限，不能静默作为默认 provider。"
  ];
}

export function camoufoxLimitations(official = false): string[] {
  if (official) return [
    "仅接受 owner 提供且重新验证的 official_release source、Camoufox 0.5.6、browser 152.0.4-beta.30、Playwright 1.60.0 和 properties hash。",
    "Driver 只调用公开 launch_options、sync_playwright、persistent context 和 Page API；不恢复旧 patched/native adapter/browser builder。",
    "popup 首请求在无法建立可信 Page 归属时本地拒绝；原生焦点是可选 Viewer，不能替代 task Page。",
    "不暴露 CDP、原始 endpoint、raw DOM、HAR 或反检测成功保证。"
  ];
  return [
    "Camoufox 仅保留安装、绑定和恢复查询事实；私有浏览器/Driver 启动绑定已退役。",
    "Harbor 不创建 Profile、不启动 Camoufox，也不把 Camoufox 自动替换为其他 provider。",
    "待未来通过独立 Qualification Gate 的原版核心能力后，才能另行定义新的支持路线。"
  ];
}

export function cloakDownloadGuide(): BrowserProviderDownloadGuide {
  return {
    action: "managed_install",
    primary_url: "https://cloakbrowser.dev",
    fallback_url: "https://github.com/CloakHQ/cloakbrowser/releases",
    install_hint: "请通过 Harbor managed lifecycle 安装官方签名版本；显式本机二进制覆盖继续由外部管理。",
    missing_impacts: [
      "CloakBrowser 不能作为主力 provider 被选择。",
      "原生指纹和反检测 provider claim 不可用。",
      "身份环境可能后备到官方 Chrome，且一致性能力降低。"
    ]
  };
}

export function chromeDownloadGuide(): BrowserProviderDownloadGuide {
  return {
    action: "manual_install",
    primary_url: "https://www.google.com/chrome/",
    install_hint: "请安装官方 Google Chrome，或设置 HARBOR_CHROME_PATH/CHROME_PATH 指向 Chrome 可执行文件。",
    missing_impacts: [
      "如果 CloakBrowser 也缺失，将没有受限后备 provider。",
      "本地 smoke 不能把官方 Chrome 用作备用 runtime。"
    ]
  };
}

export function camoufoxDownloadGuide(official = false): BrowserProviderDownloadGuide {
  return {
    action: "external_management",
    primary_url: "https://github.com/daijro/camoufox/releases",
    install_hint: official ? "仅由 installed owner 提供固定官方 Camoufox/Playwright 组合及完整 provenance；Harbor 不自行下载、补丁或替换。" : "Camoufox 的历史 Harbor 私有启动绑定已退役；未验证官方 provenance 时不要设置启动覆盖。",
    missing_impacts: [
      official ? "缺失任一固定 source/version/hash 或 Python/Playwright runtime 时不能启动。" : "Camoufox 不能作为身份环境 provider 启动。",
      "旧 binding 保留为管理和恢复诊断事实，但不会启动或自动 fallback。",
      "Harbor 不修改上游 Camoufox，也不复制 patched/native adapter。"
    ]
  };
}

function capability(
  key: BrowserProviderCapabilityKey,
  state: BrowserProviderCapabilityState,
  source: BrowserProviderFactSource,
  note: string
): BrowserProviderCapabilityFact {
  return { key, state, source, note };
}
