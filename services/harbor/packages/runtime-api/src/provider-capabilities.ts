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

function capability(
  key: BrowserProviderCapabilityKey,
  state: BrowserProviderCapabilityState,
  source: BrowserProviderFactSource,
  note: string
): BrowserProviderCapabilityFact {
  return { key, state, source, note };
}
