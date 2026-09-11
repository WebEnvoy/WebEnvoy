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

export function camoufoxCapabilities(): BrowserProviderCapabilityFact[] {
  return [
    capability("persistent_profile", "supported", "configured", "Camoufox 通过 Playwright persistent context 使用专用持久化 profile。"),
    capability("independent_user_data_dir", "supported", "configured", "每个 Harbor Profile 使用独立的 Firefox/Camoufox profile 目录。"),
    capability("proxy", "limited", "configured", "Driver 只把已解析的代理配置交给 Camoufox；连接结果仍需运行时观察。"),
    capability("timezone", "limited", "configured", "Driver 将配置时区交给 Camoufox，并以运行时事实回读；完整指纹一致性不在此切片。"),
    capability("locale", "limited", "configured", "Driver 将语言交给 Camoufox，并以运行时页面事实回读。"),
    capability("viewport", "limited", "configured", "Driver 将窗口/视口交给 Camoufox；窗口 readback 由页面事实和 provider 诊断覆盖。"),
    capability("extensions", "unsupported", "configured", "本切片不配置或管理扩展。"),
    capability("cookie_persistence", "supported", "configured", "Playwright persistent context 将会话存储在同一 managed Profile。"),
    capability("cdp", "unsupported", "configured", "Camoufox 使用 Firefox/Juggler pipe；Harbor 不等待 DevToolsActivePort。"),
    capability("viewer", "limited", "configured", "有头 Driver 暴露本地窗口给既有 ViewerControl；Harbor 不暴露 Juggler pipe。"),
    capability("snapshot_refs", "limited", "configured", "snapshot ref 继续依赖存活 Runtime Session 和既有受控页面边界。"),
    capability("evidence_refs", "limited", "configured", "evidence ref 继续依赖 Harbor 策略和存活 Runtime Session。"),
    capability("native_fingerprint_control", "provider_claim", "provider_claim", "Camoufox 原生指纹能力只作为 provider claim，未在此切片承诺任务成功率。"),
    capability("anti_detection_binary_patches", "provider_claim", "provider_claim", "Camoufox 二进制反检测能力只作为 provider claim。"),
    capability("automation_exposure_reduction", "provider_claim", "provider_claim", "Camoufox automation exposure 降低只作为 provider claim。")
  ];
}

export function obscuraCapabilities(): BrowserProviderCapabilityFact[] {
  return [
    capability("persistent_profile", "limited", "validation_evidence", "固定源码构建仅验证 Cookie 跨进程重启持久；localStorage 与 IndexedDB 不持久。"),
    capability("independent_user_data_dir", "supported", "configured", "每个 Harbor Profile 使用一个专用 Obscura 进程和独立受管目录。"),
    capability("proxy", "limited", "configured", "Harbor 仅向专用进程注入已解析代理；固定源码提交修复了 render 资源绕过代理的问题。"),
    capability("timezone", "limited", "configured", "Harbor 在 V8 初始化前为专用进程设置固定 IANA timezone，并运行时回读。"),
    capability("locale", "limited", "provider_claim", "固定 profile 的语言只能观测，当前不能按 Profile 任意配置。"),
    capability("viewport", "limited", "configured", "Driver 通过 CDP device metrics 设置并回读 viewport。"),
    capability("extensions", "unsupported", "configured", "Obscura 当前不提供扩展管理。"),
    capability("cookie_persistence", "supported", "validation_evidence", "Cookie 在底层连接优雅关闭后写入受管目录，并在专用进程重启时恢复。"),
    capability("cdp", "limited", "validation_evidence", "Harbor 独占一条 loopback CDP WebSocket；raw endpoint 不向 App 或 Plugin 暴露。"),
    capability("viewer", "limited", "validation_evidence", "截图与受控输入可指向原 target；完整 App viewer 和真实 IME 尚未验证。"),
    capability("snapshot_refs", "limited", "configured", "snapshot ref 仅在 Harbor 持有的底层连接和当前 Page generation 内有效。"),
    capability("evidence_refs", "limited", "configured", "截图摘要可产生 evidence ref；不导出原始页面材料。"),
    capability("native_fingerprint_control", "limited", "provider_claim", "固定 profile 0 且禁用轮换；尚无完整跨表面一致性验证。"),
    capability("anti_detection_binary_patches", "unsupported", "configured", "本轮 render 构建未启用 stealth feature。"),
    capability("automation_exposure_reduction", "requires_validation", "provider_claim", "不以 CDP 兼容或 provider 声明推断真实站点通过率。")
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
    "Chrome 是显式兼容选择；没有原生指纹控制不使它成为只能故障后备的次等路径。",
    "没有原生指纹控制或反检测二进制补丁。",
    "必须准确展示身份环境一致性限制，不能静默替换用户选择。"
  ];
}

export function camoufoxLimitations(): string[] {
  return [
    "Camoufox 仅通过固定外部安装和 Harbor Driver 选择；不加入 provider 插件平台。",
    "当前 Driver 只承诺持久 Profile、受控页面导航、生命周期和低风险页面 readiness probe；不承诺通用 CDP/DSL。",
    "原生指纹、反检测和目标站点通过率保留为 provider claim，必须由独立验证证据升级。",
    "Camoufox Python 0.5.6、兼容的 Playwright 和 Camoufox 二进制必须由同一固定安装提供，版本或 properties.json 不兼容时相关启动动作拒绝。"
  ];
}

export function obscuraLimitations(): string[] {
  return [
    "仅支持固定 upstream 提交 01e1caa 的 macOS arm64 render 源码构建；v0.2.2 存在 render transport 安全缺陷，不能用于本接入。",
    "源码构建只有 ad-hoc 签名且 Gatekeeper 拒绝；在签名、固定分发和安装验证完成前不属于正式可安装版本。",
    "底层 WebSocket 断开会销毁现场；Driver 必须使旧 Instance/Page 失效并重启专用进程，不能声称无损恢复。",
    "仅 Cookie 跨进程重启持久；localStorage、sessionStorage 与 IndexedDB 不持久。",
    "popup、dialog、下载、完整文件上传、原生窗口和真实中文 IME 尚未成立；这些是局部能力缺口，不把 Provider 永久限定为只读。"
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
      "Chrome 不能被显式选择。",
      "依赖 Chrome 兼容性的本地 Runtime 路径不可用。"
    ]
  };
}

export function camoufoxDownloadGuide(): BrowserProviderDownloadGuide {
  return {
    action: "external_management",
    primary_url: "https://github.com/daijro/camoufox/releases",
    install_hint: "请安装并固定受支持的官方 Camoufox archive、Python camoufox 0.5.6 与兼容的 Playwright runtime，然后设置 HARBOR_CAMOUFOX_PATH。",
    missing_impacts: [
      "Camoufox 不能作为身份环境 provider 启动。",
      "没有 Juggler Driver 就不能把 Camoufox 当作 Chromium/CDP 使用。",
      "properties.json bundle 路径不兼容时，Driver 会拒绝启动并返回诊断。"
    ]
  };
}

export function obscuraDownloadGuide(): BrowserProviderDownloadGuide {
  return {
    action: "external_management",
    primary_url: "https://github.com/h4ckf0r0day/obscura",
    install_hint: "仅为有界验证配置固定提交 01e1caa 的 render 构建与校验 hash；不要自动跟随 latest 或替换用户现有 Provider。",
    missing_impacts: [
      "Obscura 不能被显式选择或启动。",
      "其他已安装 Provider 和既有 Profile 不受影响。",
      "没有签名的正式分发包时，Obscura 仍是受限验证状态。"
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
