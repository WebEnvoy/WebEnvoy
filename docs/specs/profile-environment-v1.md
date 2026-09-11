# Profile Environment V1

> 状态：V1 规范性语义规格
> 版本：1.1
> 日期：2026-09-11
> 产品依据：[canonical v1.2](https://github.com/WebEnvoy/.github/blob/main/docs/product-architecture-v1.md)
> 架构依据：[ADR 0012](../adr/0012-runtime-capability-plane-and-plugin-first.md)、[Runtime Capability Plane](../architecture/runtime-capability-plane.md)
> 产品归口：[Provider／环境 FR #471](https://github.com/WebEnvoy/WebEnvoy/issues/471)
> 首批执行项：[Camoufox 环境连续性 #499](https://github.com/WebEnvoy/WebEnvoy/issues/499)

本文定义 WebEnvoy V1 中长期受管 Profile 的 Provider 和设备／网络环境语义。目标是让同一 Profile 跨正常停止、重启和受支持版本变化后，继续表现为**同一个可解释、可验证、可恢复的长期环境**。

本文不承诺不可检测、不封号，也不要求开启 Provider 的所有可选“隐身”功能。

## 1. 核心原则

1. Profile 是长期浏览器身份与环境容器，不只是 user-data-dir。
2. Provider executable 的来源与 Profile 数据所有权分离。
3. Profile 创建时绑定 Provider；运行时不得静默切换。
4. 关键环境不能在每次启动时无解释地重新随机。
5. 配置已保存不等于活动 Instance 已生效。
6. 环境事实必须区分 configured、effective、pending、observed 和 drift。
7. 环境应整体自洽，不对单个字段独立随机拼装。
8. 自动化辅助代码、Network 拦截、主世界执行和输入策略不得无意破坏 Provider 原生环境。
9. Provider 声称支持不等于 WebEnvoy 已验证。
10. 任务失败不得触发自动换 Provider、代理、指纹或身份环境重试。

### 1.1 用户选择、偏好与绑定

- 显式创建选择优先于用户的新建默认偏好；两者都必须实际可用且获授权。
- 人类入口在没有用户默认时可以展示可修改的推荐候选，但必须由用户确认。Agent 没有显式 template Provider 且没有用户默认时返回需要选择，不从项目工程顺序或推荐暗推。
- 显式选择或用户默认不可用时局部拒绝并返回诊断；`fallback_provider_id` 不得表示将偷偷替换选择。
- 默认偏好只影响后续创建，不迁移旧 Profile，不扩大 Grant，也不授权安装或 Provider 使用。
- Profile 一经创建永远按实际 binding 启动；跨 Provider 或不兼容版本变化走显式迁移。
- 项目工程优先级、产品推荐、用户默认偏好和 Profile binding 是四个独立事实。

## 2. 环境事实模型

当前切片的 wire schema 由第 18 节冻结；每个受管 Profile 的环境事实必须能够表达：

| 事实 | 含义 |
|---|---|
| configured | 用户或获准 Agent 保存的目标配置 |
| effective | 当前 Instance 按 WebEnvoy／Provider 已应用的配置 |
| pending | 已保存但需安全重启或迁移后才能应用的配置 |
| observed | 从当前浏览器、Provider、网络或系统实际读取的事实 |
| drift | configured／effective／observed 之间无法解释或超出允许兼容范围的差异 |
| provenance | 事实来自用户、WebEnvoy、Provider、系统还是实际观测 |
| last_verified_at | 最后一次在明确版本和 Instance 上验证的时间 |
| compatibility | 当前 Provider／版本对该事实的 supported／limited／unsupported 状态 |
| evidence refs | 支持该结论的脱敏证据引用 |

### 2.1 状态关系

```text
configured
   │
   ├─ active Instance 不可安全热变更 ──> pending
   │                                      │
   │                              safe stop / restart
   │                                      ▼
   └──────────────────────────────> effective
                                          │
                                   runtime observation
                                          ▼
                                      observed
                                          │
                         explained match / allowed variance
                             │                    │
                             ▼                    ▼
                         verified               drift
```

`observed` 不自动覆盖 `configured`。发现 drift 不得自动“修正”用户配置或重新生成环境。

## 3. 环境能力分组

每个分组必须明确：owner、持久化方式、启动应用方式、观测方式、支持状态和变化规则。

| 分组 | 至少覆盖 |
|---|---|
| Provider identity | provider id、executable、package/browser version、schema/properties version、Driver version、compatibility range |
| OS／device identity | browser family、目标 OS 表征、UA／navigator 相关设备事实 |
| Locale／timezone | language、locale、timezone、地区语义及其来源 |
| Window／screen | viewport、window、screen、DPR 等可控／可观测事实 |
| Network environment | proxy ref、实际出口、DNS／连接事实、geo、WebRTC 关系 |
| Hardware | CPU／hardware concurrency、device memory 等 |
| Graphics | GPU／WebGL／renderer 等 |
| Fonts／media | font profile、voices、media devices 等 |
| Seeds | Canvas、Audio 等关键稳定 seed 或 Provider 等价机制 |
| Browser storage | Profile data、Cookie／storage 连续性及 owner 边界 |
| Interaction policy | reliable／humanized 等适用输入策略和 Provider 支持 |
| Runtime instrumentation | evaluate world、Network interception、辅助脚本、viewer 对环境的影响 |

## 4. 环境事实 owner 类型

每个事实必须被归入以下一种主要 owner 类型。

### 4.1 WebEnvoy configured and persisted

WebEnvoy 明确生成或接受用户配置，并在 Profile 生命周期中持久化、应用和版本化。

示例可能包括：

- Provider binding；
- proxy ref；
- language／timezone；
- viewport；
- WebEnvoy 自己生成的 seed bundle；
- interaction policy；
- 环境 schema version。

### 4.2 Provider generated and persistently owned

Provider 按其正式机制生成，并随 WebEnvoy 管理的持久 Profile 或独立 Provider 配置稳定复用。WebEnvoy必须记录：

- Provider 生成机制和版本；
- 持久化位置的 owner；
- 是否会随浏览器升级改变；
- 能否回读或只验证摘要；
- 丢失或重建时的恢复语义。

不能因为“Provider 会自动生成”就假定跨重启稳定。

### 4.3 Observed only

WebEnvoy 可以从实际 Instance／网络观测，但不声称能精确控制。

例如某些 GPU、字体或系统细节。Observed-only 仍应记录：

- 观测来源；
- 时间和版本；
- 允许变化范围；
- drift 判定；
- 不支持控制时的用户说明。

### 4.4 Unsupported or limited

Provider 当前不能安全控制或验证。必须说明：

- 具体缺口；
- 受影响平台／版本；
- 是否有等价路径；
- 是否影响该 Provider 的 V1 支持范围；
- 后续迁移或人工恢复方式。

## 5. Profile 创建

创建长期 Profile 时必须：

1. 验证管理 Grant、允许 Provider、代理引用和环境模板；
2. 创建 WebEnvoy 自有 Profile data；
3. 固定 Provider binding 和适用版本／schema；
4. 建立环境事实 owner 矩阵；
5. 首次生成或接受必须持久化的环境数据；
6. 启动 Provider 并读取 effective／observed facts；
7. 检查不自洽或 unsupported 配置；
8. 保存 last_verified_at 和 evidence refs；
9. 不因 Agent 创建 Profile 获得更宽的权限 ceiling。

### 5.1 不允许的创建行为

- 使用外部软件正在写入的日常 Profile；
- 每次启动重新生成完整设备身份；
- 独立随机 UA、screen、GPU、locale、timezone 等互相关联字段；
- 代理存在但网络／geo／timezone／WebRTC 关系完全不核对；
- Provider 不支持时静默切换到另一 Provider；
- 将 Provider claim 标成 verified。

## 6. 正常启动和重启

每次启动必须：

- 核对 Provider binding、executable、version 和配置 schema；
- 获取 Profile 独占锁；
- 加载相同持久环境；
- 将 configured／pending 的适用部分解析为启动配置；
- 启动原 Provider；
- 回读关键 effective／observed facts；
- 更新 last_verified_at 或记录 drift／unavailable；
- 不因启动失败重新随机或自动换代理／Provider。

正常重启后至少应保持：

- 同一 Profile data；
- 同一 Provider family；
- 同一环境 bundle／关键 seed 的 owner 连续性；
- 同一代理引用或明确无代理；
- 可解释的 locale／timezone／window；
- Account 绑定和登录存储；
- 版本变化导致的允许差异记录。

## 7. 运行中变更

### 7.1 可立即应用

只影响 WebEnvoy 元数据且不改变浏览器现场的名称、标签、备注、分组等，可以立即生效。

### 7.2 需要 pending

以下变化默认不得对活动 Instance 静默热应用：

- proxy／network exit；
- geo／timezone／locale；
- viewport／screen；
- hardware／GPU／WebGL；
- fonts／seed；
- interaction policy；
- Provider 兼容版本策略。

保存后应：

```text
configured updated
effective unchanged
pending visible
```

安全停止／重启后：

```text
pending applied
new effective observed
drift evaluated
```

### 7.3 需要迁移

- Provider family 变化；
- 不兼容浏览器／环境 schema；
- 无法在原 Profile data 上安全升级；
- 需要重建关键环境身份。

必须走显式迁移，不得把目标环境作为第二个正式可运行的同账号 Profile。

## 8. Drift

### 8.1 Drift 类别

至少区分：

- Provider／version drift；
- config application drift；
- network／proxy drift；
- geo／locale／timezone／WebRTC inconsistency；
- device／hardware／graphics drift；
- seed／profile continuity drift；
- storage／identity drift；
- instrumentation compatibility drift。

### 8.2 Drift 响应

发生 drift 时：

- 只阻断受影响能力或身份依赖操作；
- 保留 Profile data 和现场；
- 不自动清 Cookie、退出账号、换代理、换 Provider 或生成新指纹；
- 给出诊断、重新验证、重启、修复或迁移入口；
- 不改写已发生的 ExternalOutcome。

### 8.3 允许变化

版本升级可能带来合理变化。允许范围必须由：

- Provider compatibility；
- WebEnvoy version policy；
- 当前 Profile environment schema；
- 实际验证证据；

共同解释，不能用“浏览器升级了”笼统忽略全部变化。

## 9. Network、Geo 和 WebRTC 一致性

系统必须明确区分：

- 用户配置的 proxy ref；
- Runtime 实际解析的 proxy endpoint；
- 浏览器实际网络出口；
- geo／country／timezone／locale 的配置或推导；
- WebRTC 可观测网络身份；
- DNS／连接失败等运行事实。

### 9.1 基本规则

- proxy label 不能代替可解析 proxy ref；
- proxy 配置成功不等于实际出口已验证；
- 自动 geo 推导不能静默覆盖用户 configured facts；
- 用户配置与 Provider 自动推导冲突时进入 pending／drift／refusal，而不是悄悄选一个；
- 不把内部代理凭据暴露给 Agent；
- 不通过随机换代理修复站点失败；
- WebRTC／geo 无法验证时明确标记 unknown／limited。

本规范不强制开启某个具体 Camoufox `geoip` 选项；采用方式由固定版本验证决定。

## 10. Device／fingerprint continuity

“设备环境连续”不表示 WebEnvoy 自己必须控制每个浏览器属性；它表示每个关键事实都有明确 owner 和可解释生命周期。

### 10.1 必须回答

- 首次由谁生成；
- 保存在哪里；
- 正常重启是否复用；
- Provider 升级时是否变化；
- 能否实际回读；
- 变化怎样判定 drift；
- 丢失后怎样恢复或迁移。

### 10.2 关键分组

至少核对：

- browser／OS identity；
- screen／window；
- CPU／memory；
- GPU／WebGL；
- fonts；
- Canvas／Audio 等 seed；
- voices／media devices；
- locale／timezone／geo；
- WebRTC；
- headers 与页面属性一致性。

不得以单一“fingerprint id”掩盖内部事实不自洽，也不应向 Agent 暴露完整可复制的敏感环境材料。

## 11. Camoufox 适配要求

Camoufox 是当前第一验证 Provider。WebEnvoy 必须按明确版本组合记录：

- Camoufox package version；
- browser version；
- Playwright／Driver version；
- properties／configuration schema；
- executable source；
- platform／architecture；
- capability and limitation facts。

### 11.1 正式启动机制

应使用当前已验证的 Camoufox 公共启动机制和持久 Profile，不依赖 raw Firefox 日常目录或 Chromium/CDP 假设。

### 11.2 环境生成与复用

[#499](https://github.com/WebEnvoy/WebEnvoy/issues/499) 必须实测确定：

- Camoufox 自己生成并随 persistent context 复用的事实；
- WebEnvoy 必须显式生成、持久化和回灌的事实；
- 每次只能观测、无法精确控制的事实；
- 当前版本 unsupported／limited 的事实。

在该矩阵完成前，不能仅凭使用 Camoufox 声称完整设备环境跨重启稳定。

### 11.3 自动化暴露和辅助能力

以下机制必须在使用时记录并验证其影响：

- isolated／main world evaluation；
- Network routing／interception；
- injected deterministic helper；
- screenshot／viewer；
- Playwright／Juggler connection；
- input／humanize policy。

`main_world_eval` 或某个等价开关的存在本身不自动构成缺陷；必须检查实际调用世界、注入、页面可见副作用和版本行为。

`humanize` 等可选输入能力不要求默认开启。是否采用取决于：

- 任务可靠性；
- 人工观看体验；
- 性能；
- Provider 环境一致性；
- 实际验证。

自然交互不能变成随机无意义行为、养号或规避平台安全。

## 11A. Obscura 有界适配要求

Obscura 仅按 [Obscura Managed Provider Validation V1](obscura-managed-provider-validation-v1.md) 的固定提交、平台和 Driver 边界登记为可选受限验证 Provider，不替代 Camoufox、Chrome 或 CloakBrowser，也不预设为只读 Provider。

- 一个受管 Profile 对应一个专用进程、一个独立目录和 Harbor 持有的一条底层 WebSocket。
- App、Agent 和 Viewer 只能使用 owner API；不得获取 raw CDP endpoint、存储路径或 Obscura MCP。
- 底层连接丢失时旧 Instance/Page/observation/target ref 全部失效；恢复必须停止旧进程并从同 Profile 显式创建新 Instance，不自动重放写入。
- Provider 原生持久化当前只证明 Cookie；localStorage、sessionStorage、IndexedDB 必须标为 limited／unsupported，直到存在正式保存回灌合同。
- `OBSCURA_PROFILE=0` 与禁用 rotation 只固定当前 Provider profile 选择，不能代替完整设备 seed 连续性证明。

## 12. Provider version 变化

### 12.1 兼容升级

只有在版本策略允许并完成验证时，原 Profile 才能继续运行。升级应：

- 保存旧 Provider／environment provenance；
- 检查配置 schema；
- 应用兼容转换；
- 启动并回读关键 facts；
- 标记允许变化和 drift；
- 保留恢复方案。

### 12.2 不兼容升级

不得直接覆盖原环境。应：

- 停止相关运行；
- 创建迁移／恢复方案；
- 不让目标环境成为第二个正式同账号 Profile；
- 必要时重新登录和验证 Account／BusinessTarget；
- 显式切换正式归属；
- 原环境转为恢复备份。

### 12.3 启动失败

失败不得触发：

- 自动换 Provider；
- 自动换 proxy；
- 自动重新生成 environment；
- 清理 Profile；
- 改写已有 Run／ExternalOutcome。

## 13. Plugin 管理与展示

在有效 Grant 内，已安装 Plugin 应能够：

- 查询 Provider／Driver／environment support facts；
- 查询 configured／effective／pending／observed／drift；
- 查看 last_verified_at 和有界诊断；
- 保存获准的非破坏性环境变更；
- 发起安全重启、重新验证或迁移请求；
- 查询操作结果，断线后不重放；
- 不读取 proxy credential、完整 fingerprint bundle 或 Profile 本地路径。

完整 App 后置时，这些 Agent 可委托能力不能只有 App 内部入口。必须由人作出的 Provider 安装、权限扩大、迁移切换或破坏性决定仍进入可信 owner control plane。

## 14. Grant 和权限

环境权限必须与普通浏览器使用权分离。至少区分：

- environment facts read；
- non-destructive environment update；
- proxy reference selection；
- restart／revalidate；
- Provider update／repair request；
- migration prepare／commit；
- destructive reset／delete。

创建 Profile 只能使用用户批准的 environment／permission template，不能通过模板提高自身权限。

SKILL 不允许更换 Provider、重生成 fingerprint、修改 UA、换 proxy 或改变 Account 绑定。

## 15. 数据与隐私

不得向普通 Agent 直接暴露：

- proxy username／password；
- Cookie、token、credential；
- Profile 路径；
- 可复制的完整浏览器存储；
- 未脱敏的设备环境私密材料；
- raw diagnostic dump。

公共结果应优先返回：

- normalized facts；
- support／drift state；
- opaque refs；
- bounded diagnostic；
- recovery action。

证据保存与实时观测分离，不能因为环境验证默认长期录制页面或网络内容。

## 16. 验证要求

### 16.1 首次环境矩阵

对固定 Provider／平台／版本逐项记录：

| 字段 | 要求 |
|---|---|
| environment group | 属于哪个分组 |
| owner type | WebEnvoy／Provider-persisted／observed-only／unsupported |
| configured source | 用户、template、Provider、system |
| persistence | 存储和版本 owner |
| launch application | 如何应用 |
| observed readback | 怎样验证 |
| restart result | 是否连续 |
| version result | 升级／schema 变化语义 |
| support state | supported／limited／unsupported |
| evidence | fixture／live／Plugin live |

### 16.2 最小 live

至少使用同一个隔离非生产 Profile：

1. 首次启动并记录关键 facts；
2. 正常停止；
3. Runtime／Instance 重启；
4. 回读相同长期环境；
5. 保存一个当前实际支持的环境变更；
6. 活动 Instance 显示旧 effective 和新 pending；
7. 安全重启；
8. 新 effective 与 configured 匹配；
9. 一个不支持／不兼容配置准确拒绝且不污染原 Profile；
10. Plugin 查询全部结果。

### 16.3 深层能力兼容

Network／Console／controlled evaluation／viewer 等首批能力必须证明：

- 不泄露敏感环境；
- 不绕过 Provider；
- 不无意改变关键 environment facts；
- 接管和重启后可恢复；
- Provider 版本变化时证据是否仍适用。

### 16.4 不构成完成

- 仅检查 user-data-dir 存在；
- locale／timezone 两个字段相同；
- Provider 文档声称 stealth；
- 每次启动生成新环境但页面仍能打开；
- 只在 headless fixture 验证；
- Plugin 只能看到 configured，不能看到 effective／pending／drift；
- 将 unsupported 字段从 UI 隐藏；
- 用换代理／Provider让测试通过。

## 17. 明确非目标

- 保证不可检测或不会封号；
- 自动养号、虚假互动；
- 在挑战后轮换环境；
- 支持所有 Camoufox 可选开关；
- 一次覆盖所有操作系统和架构；
- Provider marketplace；
- 任意 Provider 热切换；
- 将外部日常 Profile 长期挂载；
- Agent 读取完整 fingerprint、Cookie 或代理凭据；
- 用环境配置替代 Account／BusinessTarget 验证。

## 18. 首个正式环境生命周期合同（#499）

版本：`harbor-profile-environment/v1`；owner：Harbor（配置、Instance 应用和观测）、Core（授权、Run、查询）。Provider-private 持久材料另见 [Camoufox 环境连续性 V1](camoufox-environment-continuity-v1.md)，不得出现在本公共结构中。

### 18.1 调用和授权

Installed Plugin 的 `environment.read` 和 `environment.update` 复用现有 `webenvoy_operation`；输入必须包括 `idempotency_key`、`grant_id`、`task_scope`、`profile_ref`、精确 `origin`，Connector 绑定 Connection。两项分别需要既有 `allowed_operations` 中的同名操作，继续取 Profile ceiling ∩ Grant ∩ task scope 的交集。没有新 Grant field、scope dimension 或隐含权限；创建新 Profile 不能提高模板上限。

`environment.update` 额外且仅接受 `configuration: {timezone?: string, language?: string, viewport?: string}`，至少一个字段，每项为 1–128 字符且无控制字符的字符串。时区为有效 IANA 名称，language 为有效 locale，viewport 为既有 `宽x高` 表示（每边 200–16384）；拒绝空值、未知字段和不支持值。此切片不允许 Agent 改 Provider、proxy、hardware、GPU、seed 或 fingerprint。

Core 通过受保护的 Harbor `GET /runtime/identity-environments/{ref}/environment` 读取；`POST` 同路径以 `{idempotency_key, configuration}` 保存。POST 复用既有 `edit` mutation 和持久 receipt，不在浏览器上执行热变更。响应丢失时，Core 查询原 Run／mutation receipt，不再发送更新；新 read 只反映当前事实。停止和重启使用已授权的 `instance.stop/start`，不自动执行。

### 18.2 公共 envelope

成功为 `{status: "completed", schema_version: "harbor-profile-environment/v1", profile_ref, identity_environment_ref, runtime_session_ref, configured, effective, pending, observation_status, observed, provider, bundle_hash, drift, last_verified_at, support}`。

| 字段 | 类型和语义 |
| --- | --- |
| refs | Profile、Environment 为 opaque string；`runtime_session_ref` 为当前活动 Instance ref 或 `null` |
| `configured` | `{provider_id, proxy_ref, geoip_mode, language, timezone, viewport}`，值为 string 或 null；由已保存 Profile 配置派生，禁止 endpoint／凭据 |
| `effective` | 同形配置或 null；只来自该活动 Instance 成功启动时的不可变配置快照，不由保存配置改写；无活动 Instance 时为 null |
| `pending` | 同形配置或 null；configured 尚未应用到活动 Instance 时为 configured，否则 null；没有活动 Instance 时，configured 等待下次启动 |
| `observation_status` | `observed`、`unavailable` 或 `inactive`，不把读取失败伪装为空的成功观测 |
| `observed` | 当前有界环境回读或 null，结构见下文；不会覆盖 configured |
| `provider` | `{camoufox_version, browser_version, properties_sha256}` 或 null，仅来自已校验 Driver 回读 |
| `bundle_hash` | 64 位小写十六进制摘要或 null；稳定身份材料摘要，不包含可变 timezone/locale/viewport，不授予重建身份的材料 |
| `drift` | `{state: match\|drift\|unknown, checked_fields: string[], changed_fields: string[], unknown_fields: string[]}`；只对 checked_fields 宣称结果，不把 unknown 当成一致 |
| `last_verified_at` | 当前 Instance 最近成功环境回读的 UTC ISO 时间或 null；仅证明该 Instance/Provider，不跨 Runtime 退出冒称仍新鲜 |
| `support` | 已实现配置字段、实际可回读字段和明确限制；代理出口、geo、WebRTC 等未观测项不得标 verified |

`observed` 固定包含 nullable `language`、`timezone`、`hardware_concurrency`、`device_memory`、`webgl_vendor`、`webgl_renderer`、`fonts_hash`、`voices_hash`、`canvas_hash`、`audio_hash`，`languages` 为至多 16 项的字符串列表，`viewport`/`screen` 为 `{width,height}` 或 null。普通字符串至多 256 字符；hash 为 64 位小写十六进制。不包含字体／声音完整列表、raw canvas/audio、seed、完整指纹、Cookie 或存储内容。缺失或不支持的观察必须为 null／unknown，不从 configured 猜测。

Camoufox 的 `canvas_hash` 使用 [私有观测合同](camoufox-environment-continuity-v1.md) 的 `rgba8-240x60-v1` 固定绘图 RGBA8 摘要，不比较 PNG 编码元数据。旧 PNG 基线保留，升级观测算法的当前 Instance 为 unknown，必须另一次同 Profile 启动后才能验证 Canvas continuity；不得将不同算法摘要直接比较。

### 18.3 状态、漂移和失败

本 Runtime 持有的活动 Instance 上保存 A→B 后：configured=B、effective=A、pending=B；只更新 owner 配置记录，不调用 Provider 配置 mutation、不改变租约或浏览器现场。未由本 Runtime 持有的外部 Profile 锁仍按既有规则拒绝。安全停止后 effective=null；同 Profile 成功重启后 effective=B、pending=null，再以浏览器回读检验 B。启动失败保留 configured 和原材料，不创建替代 Profile 或回退 Provider。

Drift 比较实际应用配置与回读的 timezone/language，以及 Provider-private 连续性校验明确可比较的字段。已解释的 pending 差异不算 drift；未知网络出口／geo／WebRTC 或 unsupported 设备事实只限制相关结论，不阻塞无关 Profile／能力。观测只读，不发外部网络探测，不启动/停止 Instance。读操作与既有在途 Provider 计数共用生命周期保护，但不取得输入 ControlLease。

缺失 Profile、非法输入、配置拒绝或持久化失败返回 `{status:"unavailable",failure_class,message,retryable}`，failure_class 复用既有 mutation code；message 为固定有界摘要。活动 Provider 暂不可读时仍可返回已保存 configured 和已知启动快照，但 observation_status=unavailable、observed=null、drift=unknown；不能声称保存失败或启动配置已回读。

本合同新增的是固定操作值和公共读模型。配置仍使用既有 Profile store 和 edit receipt，无重复持久配置状态或第二调度器。旧 Grant 不自动获得新操作；旧 Runtime／Plugin 缺少此版本时明确不可用。兼容升级、迁移及 private bundle 修复仍需 owner 决定，本项不提供任意环境编辑器。
